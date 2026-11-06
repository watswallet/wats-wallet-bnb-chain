// CoW servisi (arka plan orkestrasyonu): quote() = COW_QUOTE'un tum isi (spec 6.4 adim 1-4, 6.3, 8.3, 9; K1, K5, K6, K8, K12).
// Butun bagimliliklar enjekte edilir (ag/depo/saat); modul durumu ve tarayici nesnesi YOK.
// Teklif ONCESI kapilar (piyasa, referans) CoW'a gitmeden karar verir (Review Focus 1).
// quote() HIC firlatmaz; sonuc mesaj-guvenlidir (BigInt YOK). Bayrak kapisi burada degil (Task 17).
import { formatUnits, parseUnits } from 'ethers'
import {
  APPROVE_WINDOW_MS,
  FEE_PREPARE_TIMEOUT_MS,
  LOCK_REASON,
  LOW_NETWORK_FEE_CHAINS,
  ORDER_VALIDITY_SEC,
  PARTNER_FEE_RECIPIENT,
  partnerRecipientCheck,
  payTokenByAddress,
  permitSupported,
} from './config'
import { parseFeeAmount } from './api'
import { COW_ERROR, isCowCode } from './errors'
import { smallAmountInfo } from './minAmount'
import {
  buildAppData,
  buildOrder,
  buildPostBody,
  computeAmounts,
  domainSeparator,
  orderDigest,
  orderUid,
  signOrder,
} from './order'
import { marketNotice, preQuoteLock } from './marketGate'
import { buildDisplay, referenceMicro, tradeGate } from './pricing'
import {
  buildPermitHook,
  decideApproval,
  permitDomain,
  permitTypedData,
  signPermit,
  verifyPermitDomain,
} from './permit'
import { ORDER_STATUS, newOrderRecord, reservedAmount } from './orders'
import { evaluateFeeGate, feeDebtLock, newFeeState } from './fee'
import { validateQuoteId, validateQuoteRequest } from './validate'
import { buildCowOrderPendingSkeleton } from '../processTransaction'

const DIGITS = /^\d+$/

const fail = (code, detail) => (detail === undefined ? { success: false, code } : { success: false, code, detail })

// Kodlu hata kodu aynen; baska her sey UNKNOWN (ic hata metni sizmaz).
const codeOf = (e) => (e && isCowCode(e.code) ? e.code : COW_ERROR.UNKNOWN)

// fee.mode yoksa/kapaliysa Faz 2 ile ayni gorunum
const NO_FEE_PREVIEW = Object.freeze({ mode: 'none', quotedAtsRaw: null, decimals: null, hint: false, lowNetworkFee: false })
// Hazirlik yetersizligi ATS ipucu satirini acar; diger sebepler (zincir, ucret bilinmiyor, hata) acmaz
const FEE_HINT_REASONS = new Set(['NOT_READY', 'BOOTSTRAP', 'BALANCE_LOW', 'BALANCE_UNKNOWN'])

// Zaman asimi: sure dolunca reddeder; zamanlayici her durumda temizlenir
function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const isDigits = (v) => typeof v === 'string' && DIGITS.test(v)
const sameAddr = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

// protocolFeeBps: sonlu sayi dizesi ("2"); aksi gecersiz.
const isFiniteNumberString = (v) => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))

// K8: permit yolu ancak bilgi okunduysa VE hesaplanan ayirici zincirdekiyle esitse acilir; uyusmazlik hata degil, false.
function permitInfoOk(info, { chainId, token }) {
  if (!info || info.ok !== true) return false
  try {
    verifyPermitDomain(permitDomain({ chainId, token, name: info.name, version: info.version }), info.separator)
    return true
  } catch {
    return false
  }
}

/**
 * api = createCowApi(), chain = createCowChain(), reference = createCowReference(),
 * quoteStore = { saveQuote, claimQuote, newQuoteId } (storage bagli), orders = { loadOrders, saveOrder, patchOrder, removeOrder },
 * pendingRows = { save, resolve, remove } (Task 14 kullanir).
 */
export function createCowService({
  api,
  chain,
  reference,
  quoteStore,
  orders,
  pendingRows,
  now = Date.now,
  recipient = PARTNER_FEE_RECIPIENT,
  fee = null,
  feeEnabled = () => false,
} = {}) {
  // Faz 3 ucreti yalniz fee verilmis VE bayrak acikken devrede; aksi halde Faz 2 cagri dizisi birebir
  const feeOn = () => {
    try {
      return fee != null && feeEnabled() === true
    } catch {
      return false
    }
  }

  // Salt-okur hazirlik + hazirlik karari; hata/zaman asimi kullaniciyi bloklamaz -> none (hint yok)
  async function feeGateNow({ owner, chainId }) {
    try {
      const p = await withTimeout(Promise.resolve().then(() => fee.prepare({ owner, chainId })), FEE_PREPARE_TIMEOUT_MS)
      const gate = evaluateFeeGate({
        flagOn: true,
        chainId,
        isEvm: true,
        status: p?.status,
        balanceRaw: p?.balanceRaw,
        quotedFeeRaw: p?.quotedFeeRaw,
      })
      return { ...gate, quotedFeeRaw: p?.quotedFeeRaw, decimals: Number.isInteger(p?.decimals) ? p.decimals : null }
    } catch {
      return { mode: 'none', reason: 'PREPARE_FAILED', quotedFeeRaw: null, decimals: null }
    }
  }

  async function quoteInner({ request, owner }) {
    // 1. dogrulama; ortak alici kontrolu ag cagrisindan ONCE (degismez 9)
    const v = validateQuoteRequest(request, { owner })
    if (!v.ok) return fail(v.code)
    if (!partnerRecipientCheck(recipient).ok) return fail(COW_ERROR.PARTNER_FEE_RECIPIENT_MISSING)
    const { side, chainId, owner: ownerAddr, stock, pay, amountText } = v.value

    // 1b. Faz 3 borc kilidi (spec 6.5): odenmemis ATS ucreti varken yeni teklif yok; CoW/RPC cagrisindan ONCE
    const feeActive = feeOn()
    if (feeActive) {
      const debt = feeDebtLock({ list: await orders.loadOrders(), owner: ownerAddr, flagOn: true, now: now() })
      if (debt) {
        return {
          success: true,
          locked: true,
          lockReason: LOCK_REASON.FEE_DEBT,
          quoteId: null,
          display: null,
          approval: null,
          reference: null,
          notice: null,
          warnings: [],
          feeDebtUids: debt.uids,
        }
      }
    }

    // 2. teklif ONCESI kapilar: kilit varsa chain.* ve api.* hic cagrilmaz
    const [refRes, tradingRes] = await Promise.all([reference.getReference(chainId, stock), reference.getTrading(stock)])
    const ref = refRes?.reference ?? null
    // getTrading onbellekteki nesneyi referansla dondurur: yalniz okunur, DEGISTIRILMEZ
    const trading = tradingRes?.ok === true ? tradingRes.trading : null
    const notice = marketNotice(trading)
    const lock = preQuoteLock({ side, trading, reference: ref })
    if (lock) {
      return {
        success: true,
        locked: true,
        lockReason: lock.code,
        nextChangeAt: lock.nextChangeAt,
        quoteId: null,
        display: null,
        approval: null,
        reference: ref,
        notice,
        warnings: [],
      }
    }
    // Sat'ta kapali/bilinmeyen piyasa kilit degil, bilgi satiri
    const warnings = []
    if (side === 'sell' && notice.state !== 'open') {
      warnings.push({
        code: notice.state === 'closed' ? LOCK_REASON.MARKET_CLOSED : LOCK_REASON.MARKET_UNKNOWN,
        nextChangeAt: notice.nextChangeAt,
      })
    }

    // 3. ondaliklar: odeme tokeni zincirden (K5), hisse katalogdan
    const payDecimals = await chain.readDecimals(chainId, pay.address)
    const stockDecimals = stock.decimals
    const buy = side === 'buy'
    const sellToken = buy ? pay.address : stock.address
    const buyToken = buy ? stock.address : pay.address
    const sellDecimals = buy ? payDecimals : stockDecimals
    const buyDecimals = buy ? stockDecimals : payDecimals
    let S
    try {
      S = parseUnits(amountText, sellDecimals)
    } catch {
      return fail(COW_ERROR.INVALID_REQUEST)
    }
    if (S <= 0n) return fail(COW_ERROR.INVALID_REQUEST)

    // 4. paralel zincir okumalari; kullanilabilir = bakiye - bekleyen emir rezervi
    const wantPermit = buy && permitSupported(chainId, pay.address)
    const [balance, allowance, permitInfo, list] = await Promise.all([
      chain.readBalance(chainId, sellToken, ownerAddr),
      chain.readAllowance(chainId, sellToken, ownerAddr),
      wantPermit ? chain.readPermitInfo(chainId, pay.address, ownerAddr) : Promise.resolve(null),
      orders.loadOrders(),
    ])
    const available = balance - reservedAmount(list, { owner: ownerAddr, chainId, token: sellToken })
    if (S > available) {
      // Karta (gereken / mevcut / eksik) yetsin diye SAYILAR da gider: atom dizeleri + ondalik. Mevcut rezerv dusulmus,
      // negatif olamaz. Satilan token arayuzde zaten bilinir (Al'da odeme tokeni, Sat'ta hisse).
      return {
        success: false,
        code: COW_ERROR.INSUFFICIENT_BALANCE,
        requiredAtoms: S.toString(),
        availableAtoms: (available > 0n ? available : 0n).toString(),
        decimals: sellDecimals,
      }
    }

    // 5. teklif istegi (hook'suz appData)
    const appData = buildAppData({ recipient })
    const body = {
      sellToken,
      buyToken,
      from: ownerAddr,
      receiver: ownerAddr,
      kind: 'sell',
      sellAmountBeforeFee: S.toString(),
      validFor: ORDER_VALIDITY_SEC,
      appData: appData.json,
      appDataHash: appData.hash,
      signingScheme: 'eip712',
      onchainOrder: false,
    }
    const res = await api.quote(chainId, body)
    if (!res || res.ok !== true) {
      if (res?.code === COW_ERROR.AMOUNT_TOO_SMALL) {
        return tooSmallResult({ api, chainId, body, res, side, S, sellToken, sellDecimals, reference: ref })
      }
      return fail(isCowCode(res?.code) ? res.code : COW_ERROR.UNKNOWN, res?.detail)
    }

    // 6. yanit dogrulamasi
    const data = res.data
    const q = data?.quote
    if (
      !q ||
      !sameAddr(q.sellToken, sellToken) ||
      !sameAddr(q.buyToken, buyToken) ||
      !sameAddr(q.receiver, ownerAddr) ||
      q.kind !== 'sell' ||
      !isDigits(q.sellAmount) ||
      !isDigits(q.feeAmount) ||
      !isDigits(q.buyAmount) ||
      !isFiniteNumberString(data.protocolFeeBps) ||
      !Number.isInteger(data.id)
    ) {
      return fail(COW_ERROR.BAD_QUOTE_RESPONSE)
    }
    const qs = BigInt(q.sellAmount)
    const qf = BigInt(q.feeAmount)
    const qb = BigInt(q.buyAmount)
    if (qs + qf !== S) return fail(COW_ERROR.QUOTE_MISMATCH)
    if (qb === 0n) return fail(COW_ERROR.NO_LIQUIDITY)
    const expiresAt = Date.parse(data.expiration)
    if (!Number.isFinite(expiresAt)) return fail(COW_ERROR.BAD_QUOTE_RESPONSE)
    const createdAt = now()
    if (expiresAt <= createdAt) return fail(COW_ERROR.CLOCK_SKEW)

    // 7. tutarlar ve goruntu modeli; kilitli teklif de kayda yazilir (K12)
    const amounts = computeAmounts({ qs, qf, qb, protocolFeeBps: data.protocolFeeBps })
    const display = buildDisplay({ side, amounts, reference: ref, payDecimals, stockDecimals })

    // 8. onay modu (K8: ayirici uyusmazligi onchain'e duser)
    const permitOk = wantPermit && permitInfoOk(permitInfo, { chainId, token: pay.address })
    const approval = decideApproval({
      side,
      chainId,
      payToken: pay.address,
      allowance,
      sellAmount: S,
      permitInfoOk: permitOk,
    })
    const approvalOut = { mode: approval.mode, allowance: allowance.toString() }

    // 8b. kullanicinin goreceegi ATS ucreti (yalniz bilgi; fee.mode placeOrder'da karar verilir, F4)
    let feePreview = NO_FEE_PREVIEW
    if (feeActive) {
      const g = await feeGateNow({ owner: ownerAddr, chainId })
      const isAts = g.mode === 'ats'
      feePreview = {
        mode: isAts ? 'ats' : 'none',
        quotedAtsRaw: isAts ? String(g.quotedFeeRaw) : null,
        decimals: isAts ? g.decimals : null,
        hint: !isAts && FEE_HINT_REASONS.has(g.reason),
        lowNetworkFee: LOW_NETWORK_FEE_CHAINS.includes(chainId),
      }
    }

    // 9. kayit (Task 12 sekli)
    const quoteId = quoteStore.newQuoteId()
    const approveUntil = createdAt + APPROVE_WINDOW_MS
    const lockReason = display.lockReason
    await quoteStore.saveQuote({
      quoteId,
      createdAt,
      expiresAt,
      approveUntil,
      owner: ownerAddr,
      chainId,
      side,
      symbol: stock.symbol,
      stockAddress: stock.address,
      payToken: pay.address,
      sellToken,
      buyToken,
      sellAmount: S.toString(),
      // CoW feeAmount, SAT tokeninde; placeOrder kapiyi (tradeGate) bundan yeniden hesaplar
      networkFee: amounts.networkFee.toString(),
      expectedBuy: amounts.expectedBuy.toString(),
      minBuy: amounts.minBuy.toString(),
      sellDecimals,
      buyDecimals,
      protocolFeeBps: Number(data.protocolFeeBps),
      // alim tokeni atomlari
      fees: {
        network: amounts.networkCostB.toString(),
        protocol: amounts.protocolFee.toString(),
        partner: amounts.partnerFee.toString(),
      },
      cowQuoteId: data.id,
      verified: typeof data.verified === 'boolean' ? data.verified : null,
      appData: { json: appData.json, hash: appData.hash },
      approval: approvalOut,
      locked: display.locked,
      lockReason,
      consumed: false,
      feePreview: { mode: feePreview.mode, quotedAtsRaw: feePreview.quotedAtsRaw },
      display,
      reference: ref,
    })

    return {
      success: true,
      locked: display.locked,
      lockReason,
      quoteId,
      expiresAt,
      approveUntil,
      display,
      approval: approvalOut,
      reference: ref,
      notice,
      warnings,
      feePreview,
    }
  }

  /** quote({ request, owner }) -> asla firlatmaz; sonuc mesaj-guvenli (BigInt YOK). */
  async function quote(args) {
    try {
      return await quoteInner(args ?? {})
    } catch (e) {
      return fail(codeOf(e))
    }
  }

  // POST sonucu belirsiz kodlar (K9): istek gitmis olabilir, kayit ve satir KALIR; poller cozer.
  const UNCERTAIN = new Set([
    COW_ERROR.NETWORK,
    COW_ERROR.TIMEOUT,
    COW_ERROR.SERVER,
    COW_ERROR.UNKNOWN,
    COW_ERROR.BAD_RESPONSE,
  ])

  // Temizlik hatasi asil sonucu ortmesin.
  const quietly = async (fn) => {
    try {
      await fn()
    } catch {
      // yut: kayit poller'in budamasina kalir
    }
  }

  async function placeOrderInner({ quoteId, activeAddress, getSigner }) {
    // 1. kaydi tuket (K7); imzalanan HER deger bu kayittan gelir (Review Focus 2)
    const idCheck = validateQuoteId(quoteId)
    if (!idCheck.ok) return fail(COW_ERROR.INVALID_REQUEST)
    const claim = await quoteStore.claimQuote({ quoteId: idCheck.value, activeAddress, now: now() })
    if (!claim || claim.ok !== true) return fail(isCowCode(claim?.code) ? claim.code : COW_ERROR.UNKNOWN)
    const record = claim.record
    const rc = partnerRecipientCheck(recipient)
    if (!rc.ok) return fail(COW_ERROR.PARTNER_FEE_RECIPIENT_MISSING)

    const { chainId, owner, sellToken, buyToken } = record
    const S = BigInt(record.sellAmount)

    // 1b. kapi kayittan YENIDEN hesaplanir (locked bayragina guvenilmez); quote() ile AYNI tradeGate (K7)
    if (typeof record.networkFee !== 'string' || !DIGITS.test(record.networkFee)) return fail(COW_ERROR.BAD_QUOTE_RESPONSE)
    const buySide = record.side === 'buy'
    const gate = tradeGate({
      side: record.side,
      sellAmount: S,
      networkFee: BigInt(record.networkFee),
      expectedBuy: BigInt(record.expectedBuy),
      reference: record.reference,
      payDecimals: buySide ? record.sellDecimals : record.buyDecimals,
      stockDecimals: buySide ? record.buyDecimals : record.sellDecimals,
    })
    if (gate.locked) return fail(gate.lockReason)

    // 2. taze okuma: bakiye (bekleyen emir rezervi dusulmus) ve allowance
    const [allowance, balance, list] = await Promise.all([
      chain.readAllowance(chainId, sellToken, owner),
      chain.readBalance(chainId, sellToken, owner),
      orders.loadOrders(),
    ])
    if (S > balance - reservedAmount(list, { owner, chainId, token: sellToken })) {
      return fail(COW_ERROR.INSUFFICIENT_BALANCE)
    }
    let mode = record.approval?.mode
    if (mode === 'none' && allowance < S) return fail(COW_ERROR.APPROVAL_REQUIRED)
    if (mode === 'permit' && allowance >= S) mode = 'none'
    if (mode !== 'none' && mode !== 'permit') return fail(COW_ERROR.APPROVAL_REQUIRED)

    // 2b. Faz 3: borc kilidi (taze liste) ve fee.mode karari; anahtardan ve submitting'ten ONCE, tek kez (F4).
    // Kullanicinin GORMEDIGI ucret ASLA kesilmez: ats ancak onizleme ats idi VE taze kapi hala atsse.
    let feeState = newFeeState({ mode: 'none', quotedAtsRaw: null })
    if (feeOn()) {
      if (feeDebtLock({ list, owner, flagOn: true, now: now() })) return fail(COW_ERROR.FEE_DEBT)
      const seen = record.feePreview
      const g = await feeGateNow({ owner, chainId })
      if (seen?.mode === 'ats' && isDigits(seen.quotedAtsRaw) && g.mode === 'ats') {
        feeState = newFeeState({ mode: 'ats', quotedAtsRaw: seen.quotedAtsRaw })
      }
    }

    // 3. anahtar en gec anda; hesap kayittakiyle ayni olmali
    const signer = await getSigner()
    if (!sameAddr(signer?.address, owner)) return fail(COW_ERROR.ACCOUNT_CHANGED)
    const validTo = Math.floor(now() / 1000) + ORDER_VALIDITY_SEC
    // ayirici tablosu HER imzadan once sinanir
    domainSeparator(chainId)

    // 4. appData: permit hook'u ya da kayittaki hook'suz appData
    let appData
    let hooked = false
    if (mode === 'permit') {
      // permit yalniz Al'da ve odeme tokeni icin; token = emrin sat tokeni
      if (record.side !== 'buy' || !sameAddr(sellToken, record.payToken)) return fail(COW_ERROR.INVALID_ORDER)
      const info = await chain.readPermitInfo(chainId, sellToken, owner)
      if (!info || info.ok !== true) return fail(COW_ERROR.PERMIT_DOMAIN_MISMATCH)
      let typedData
      try {
        typedData = permitTypedData({
          domain: permitDomain({ chainId, token: sellToken, name: info.name, version: info.version }),
          owner,
          nonce: info.nonce,
          deadline: validTo,
        })
        // IMZALANACAK domain zincirdeki ayirici ile sinanir (Task 8 denetim notu: imzadan ONCE, fail-closed)
        verifyPermitDomain(typedData.domain, info.separator)
      } catch {
        return fail(COW_ERROR.PERMIT_DOMAIN_MISMATCH)
      }
      // imza dogru token ve dogru ag icin olmali
      if (!sameAddr(typedData.domain?.verifyingContract, sellToken) || Number(typedData.domain?.chainId) !== Number(chainId)) {
        return fail(COW_ERROR.PERMIT_DOMAIN_MISMATCH)
      }
      const permitSignature = await signPermit(signer, typedData)
      const hook = buildPermitHook({ token: sellToken, owner, deadline: validTo, signature: permitSignature })
      appData = buildAppData({ recipient: rc.recipient, hook })
      hooked = true
    } else {
      appData = buildAppData({ recipient: rc.recipient })
      if (appData.hash !== record.appData?.hash) return fail(COW_ERROR.INVALID_ORDER)
    }

    // 5. emir kayittan kurulur; hook'lu emirde quoteId hic gonderilmez
    const order = buildOrder({
      sellToken,
      buyToken,
      owner,
      sellAmount: record.sellAmount,
      buyAmount: record.minBuy,
      validTo,
      appDataHash: appData.hash,
    })
    const signature = await signOrder(signer, chainId, order)
    const uid = orderUid(orderDigest(chainId, order), owner, validTo)
    const postBody = buildPostBody({
      order,
      signature,
      quoteId: hooked ? undefined : record.cowQuoteId,
      appDataJson: appData.json,
      appDataHash: appData.hash,
    })

    // 6. write-ahead: POST'tan ONCE kalici kayit ve Gecmis satiri
    const paySymbol = payTokenByAddress(chainId, record.payToken)?.symbol
    const buy = record.side === 'buy'
    const createdAt = now()
    await orders.saveOrder(
      newOrderRecord({
        uid,
        chainId,
        owner,
        side: record.side,
        symbol: record.symbol,
        stockAddress: record.stockAddress,
        payToken: record.payToken,
        sellToken,
        buyToken,
        sellAmount: record.sellAmount,
        buyAmount: record.minBuy,
        expectedBuy: record.expectedBuy,
        sellDecimals: record.sellDecimals,
        buyDecimals: record.buyDecimals,
        validTo,
        createdAt,
        appDataHash: appData.hash,
        approvalMode: mode,
        postBody,
        fees: record.fees,
        quoteId: record.quoteId,
        fee: feeState,
      }),
    )
    try {
      await pendingRows.save(
        buildCowOrderPendingSkeleton({
          uid,
          owner,
          chainId,
          sellToken,
          buyToken,
          sellSymbol: buy ? paySymbol : record.symbol,
          buySymbol: buy ? record.symbol : paySymbol,
          sellAmountHuman: formatUnits(record.sellAmount, record.sellDecimals),
          buyAmountHuman: formatUnits(record.minBuy, record.buyDecimals),
          now: createdAt,
        }),
      )
    } catch (e) {
      // satir yazilamadi: POST henuz gitmedi, kaydi geri al
      await quietly(() => orders.removeOrder(uid))
      throw e
    }

    // 7. gonderim ve sonucun cozumu (K9)
    let res
    try {
      res = await api.postOrder(chainId, postBody)
    } catch {
      res = { ok: false, code: COW_ERROR.UNKNOWN }
    }
    const markOpen = async (extra) => {
      await quietly(() => orders.patchOrder(uid, { status: ORDER_STATUS.OPEN, postBody: null, apiStatus: 'open' }))
      return { success: true, uid, validTo, state: 'open', ...extra }
    }
    if (res?.ok === true) {
      if (typeof res.data === 'string') {
        if (res.data.toLowerCase() !== uid) {
          await quietly(() => orders.patchOrder(uid, { lastError: COW_ERROR.UID_MISMATCH }))
          return { success: false, code: COW_ERROR.UID_MISMATCH, uid }
        }
        return markOpen()
      }
      if (res.duplicated === true) return markOpen({ duplicated: true })
      return { success: true, uid, validTo, state: 'submitting' }
    }
    const code = isCowCode(res?.code) ? res.code : COW_ERROR.UNKNOWN
    if (UNCERTAIN.has(code)) return { success: true, uid, validTo, state: 'submitting' }
    // kesin red: para cikmadi
    await quietly(() => orders.removeOrder(uid))
    await quietly(() => pendingRows.remove(uid))
    return fail(code, res?.detail)
  }

  /**
   * placeOrder({ quoteId, activeAddress, getSigner }) -> asla firlatmaz. Imzalanan her deger kayittan gelir;
   * imza, postBody ve anahtar sonuca/loga girmez.
   */
  async function placeOrder({ quoteId, activeAddress, getSigner } = {}) {
    try {
      return await placeOrderInner({ quoteId, activeAddress, getSigner })
    } catch (e) {
      return fail(codeOf(e))
    }
  }

  return { quote, placeOrder }
}

// "Tutar ag ucretini karsilamiyor": CoW hata govdesindeki ucret yoksa TEK yedek teklif (~50 USD) ile ucret okunur.
const FALLBACK_USD = 50n
const FEE_MAX = 10n ** 36n
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Yedek teklif tutari (satilan token atomu): Al'da 50 stable (1:1), Sat'ta 50 USD / referans. Girileni asmiyorsa null.
function fallbackAmount({ side, sellDecimals, reference, entered }) {
  let amount
  if (side === 'buy') amount = FALLBACK_USD * 10n ** BigInt(sellDecimals)
  else {
    const rm = referenceMicro(reference)
    if (rm === null) return null
    amount = (FALLBACK_USD * 10n ** 6n * 10n ** BigInt(sellDecimals)) / rm
  }
  return amount > entered ? amount : null
}

// Yedek teklifin ag ucreti (satilan token atomu, BigInt) ya da null. Yanit ayni cifti ve ayni tarafi dogrulamali.
async function fallbackFee({ api, chainId, body, amount, sellToken }) {
  const res = await api.quote(chainId, { ...body, sellAmountBeforeFee: amount.toString() })
  const q = res && res.ok === true ? res.data?.quote : null
  if (!isObject(q) || !sameAddr(q.sellToken, sellToken) || q.kind !== 'sell' || !isDigits(q.feeAmount)) return null
  const fee = BigInt(q.feeAmount)
  return fee > 0n && fee <= FEE_MAX && fee < amount ? fee : null
}

// AMOUNT_TOO_SMALL sonucu: ucret govdeden, yoksa tek yedek teklifle; hesaplanamazsa genel hata (sayisal alan yok).
async function tooSmallResult({ api, chainId, body, res, side, S, sellToken, sellDecimals, reference }) {
  let feeAtoms = parseFeeAmount(res?.feeAtoms)
  if (feeAtoms === null) {
    const amount = fallbackAmount({ side, sellDecimals, reference, entered: S })
    const fee = amount === null ? null : await fallbackFee({ api, chainId, body, amount, sellToken })
    feeAtoms = fee === null ? null : fee.toString()
  }
  const info = feeAtoms === null ? null : smallAmountInfo({ side, feeAtoms, enteredAtoms: S, sellDecimals, reference })
  return info === null ? fail(COW_ERROR.AMOUNT_TOO_SMALL) : { ...fail(COW_ERROR.AMOUNT_TOO_SMALL), ...info }
}

// CoW emir yardimcilari I: appData (dize + hash) ve tutar hesabi (computeAmounts).
// Saf modul: config.js disinda modul durumu yok. Tutar hesabi BigInt; Number yalniz Math.round(pf * 100000).
// appCode YALNIZ burada tanimlanir (K4). Formul cow-sdk getQuoteAmountsAndCosts (market, kind sell) ile aynidir.
import { keccak256, toUtf8Bytes, getAddress, TypedDataEncoder, verifyTypedData, concat, toBeHex, isHexString } from 'ethers'
import { PARTNER_FEE_RECIPIENT, PARTNER_FEE_BPS, SLIPPAGE_BIPS, PERMIT_GAS_LIMIT, partnerRecipientCheck, cowDomain } from './config'

export const APP_CODE = 'WatsWallet'
export const APP_DATA_VERSION = '1.15.0'
export const appEnvironment = () => (import.meta.env.PROD ? 'production' : 'development')

// errors.js Task 7 de gelir; simdilik yerel tanim (cift tanim kabul).
const fail = (code, msg) => Object.assign(new Error(msg || code), { code })

/** Anahtarlari ozyinelemeli alfabetik siralar, bosluksuz JSON.stringify. Dizi sirasi korunur. */
export function canonicalJson(value) {
  const sirala = (v) => {
    if (Array.isArray(v)) return v.map(sirala)
    if (v !== null && typeof v === 'object') {
      const cikti = {}
      for (const k of Object.keys(v).sort()) cikti[k] = sirala(v[k])
      return cikti
    }
    return v
  }
  return JSON.stringify(sirala(value))
}

/**
 * @returns {{ json: string, hash: string }} hash = keccak256(toUtf8Bytes(json))
 * hook: { target, callData } (gasLimit = PERMIT_GAS_LIMIT eklenir)
 */
export function buildAppData({ recipient = PARTNER_FEE_RECIPIENT, hook = null, environment = appEnvironment() } = {}) {
  const kontrol = partnerRecipientCheck(recipient)
  if (!kontrol.ok) throw fail('PARTNER_FEE_RECIPIENT_MISSING')

  const metadata = {
    orderClass: { orderClass: 'market' },
    partnerFee: { recipient: kontrol.recipient, volumeBps: PARTNER_FEE_BPS },
    quote: { slippageBips: SLIPPAGE_BIPS },
  }

  if (hook !== null && hook !== undefined) {
    let target
    try {
      target = getAddress(hook.target)
    } catch {
      throw fail('INVALID_HOOK')
    }
    if (typeof hook.callData !== 'string' || !/^0x([0-9a-f]{2})+$/i.test(hook.callData)) throw fail('INVALID_HOOK')
    metadata.hooks = { pre: [{ callData: hook.callData, gasLimit: PERMIT_GAS_LIMIT, target }] }
  }

  const json = canonicalJson({ appCode: APP_CODE, environment, metadata, version: APP_DATA_VERSION })
  return { json, hash: keccak256(toUtf8Bytes(json)) }
}

// BigInt | tamsayi dizesi | guvenli tamsayi Number; aksi BAD_QUOTE_RESPONSE.
function toBig(v) {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v)
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v)
  throw fail('BAD_QUOTE_RESPONSE')
}

// protocolFeeBps: sunucudan dize ("2") ya da sayi; sonlu ve 0..1000.
function toProtocolFeeBps(v) {
  const sayiTipi = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')
  const pf = sayiTipi ? Number(v) : NaN
  if (!Number.isFinite(pf) || pf < 0 || pf > 1000) throw fail('BAD_QUOTE_RESPONSE')
  return pf
}

/**
 * @param girdiler BigInt | tamsayi dizesi | guvenli tamsayi Number. protocolFeeBps sunucudan gelir ("2").
 * @returns {{ S, networkFee, networkCostB, protocolFee, spotBuy, partnerFee, expectedBuy, minBuy }} hepsi BigInt
 */
export function computeAmounts({ qs, qf, qb, protocolFeeBps, partnerBps = PARTNER_FEE_BPS, slippageBips = SLIPPAGE_BIPS }) {
  const qsB = toBig(qs)
  const qfB = toBig(qf)
  const qbB = toBig(qb)
  const pf = toProtocolFeeBps(protocolFeeBps)
  if (qsB <= 0n || qbB <= 0n || qfB < 0n) throw fail('BAD_QUOTE_RESPONSE')
  const P = BigInt(partnerBps)
  const Sl = BigInt(slippageBips)

  const S = qsB + qfB
  const networkCostB = (qbB * qfB) / qsB
  const pfScaled = BigInt(Math.round(pf * 100000))
  const protocolFee = (qbB * pfScaled) / (10000n * 100000n - pfScaled)
  const spotBuy = qbB + networkCostB + protocolFee
  const partnerFee = (spotBuy * P) / 10000n
  const expectedBuy = qbB - partnerFee
  const minBuy = expectedBuy - (expectedBuy * Sl) / 10000n
  if (minBuy <= 0n) throw fail('BAD_QUOTE_RESPONSE')

  return { S, networkFee: qfB, networkCostB, protocolFee, spotBuy, partnerFee, expectedBuy, minBuy }
}

// ---------------------------------------------------------------------------
// Emir yapisi, typed data, digest, UID, imza, POST govdesi (spec 5.5, 6.4, Ek C).
// Imzalanan alanlar YALNIZ cagiranin verdigi teklif kaydi degerleridir; receiver = owner,
// kind, bakiye alanlari ve feeAmount buradan degismez (invariant 2).
// ---------------------------------------------------------------------------
export const ORDER_TYPE_STRING =
  'Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)'
export const ORDER_TYPE_HASH = '0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489'

// Ek C.2 sirasi; ic ice donduruldu.
export const ORDER_TYPES = Object.freeze({
  Order: Object.freeze(
    [
      { name: 'sellToken', type: 'address' },
      { name: 'buyToken', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'sellAmount', type: 'uint256' },
      { name: 'buyAmount', type: 'uint256' },
      { name: 'validTo', type: 'uint32' },
      { name: 'appData', type: 'bytes32' },
      { name: 'feeAmount', type: 'uint256' },
      { name: 'kind', type: 'string' },
      { name: 'partiallyFillable', type: 'bool' },
      { name: 'sellTokenBalance', type: 'string' },
      { name: 'buyTokenBalance', type: 'string' },
    ].map((a) => Object.freeze(a))
  ),
})

// Ek C.1: zincirdeki settlement.domainSeparator() degerleri (uc zincirde esit olculdu).
export const DOMAIN_SEPARATORS = Object.freeze({
  1: '0xc078f884a2676e1345748b1feace7b0abee5d00ecadb6e574dcdd109a63e8943',
  56: '0x0cbb18dfca28d2ceac8c72a17289168e03c1ad121338f5573e3b0c3255207fc7',
  42161: '0x69d78e7a7cafcaf924483f99f65e8f4e303a99a446db7ab319f9d40e940bced2',
})

/** Desteklenmeyen zincir UNSUPPORTED_CHAIN (cowDomain), sabit tabloyla esit degilse DOMAIN_MISMATCH. */
export function domainSeparator(chainId) {
  const hesap = TypedDataEncoder.hashDomain(cowDomain(chainId))
  const beklenen = DOMAIN_SEPARATORS[Number(chainId)]
  if (!beklenen || hesap !== beklenen) throw fail('DOMAIN_MISMATCH')
  return hesap
}

const UINT256_MAX = 2n ** 256n - 1n

// BigInt | ondalik tamsayi dizesi | guvenli tamsayi Number; 1..2^256-1; cikti dize.
function toAmountString(v) {
  let b
  if (typeof v === 'bigint') b = v
  else if (typeof v === 'number' && Number.isSafeInteger(v)) b = BigInt(v)
  else if (typeof v === 'string' && /^\d+$/.test(v)) b = BigInt(v)
  else throw fail('INVALID_ORDER')
  if (b <= 0n || b > UINT256_MAX) throw fail('INVALID_ORDER')
  return b.toString()
}

function toAddress(v) {
  try {
    return getAddress(v)
  } catch {
    throw fail('INVALID_ORDER')
  }
}

const isValidTo = (v) => Number.isInteger(v) && v >= 1 && v <= 0xffffffff

/** Alanlar sirasi ve degerleri sabit; sayilar DIZE (decimal), validTo Number. receiver parametre ALINMAZ. */
export function buildOrder({ sellToken, buyToken, owner, sellAmount, buyAmount, validTo, appDataHash }) {
  const sell = toAddress(sellToken)
  const buy = toAddress(buyToken)
  const receiver = toAddress(owner)
  if (sell.toLowerCase() === buy.toLowerCase()) throw fail('INVALID_ORDER')
  const sellStr = toAmountString(sellAmount)
  const buyStr = toAmountString(buyAmount)
  if (!isValidTo(validTo)) throw fail('INVALID_ORDER')
  if (typeof appDataHash !== 'string' || !isHexString(appDataHash, 32)) throw fail('INVALID_ORDER')
  return {
    sellToken: sell,
    buyToken: buy,
    receiver,
    sellAmount: sellStr,
    buyAmount: buyStr,
    validTo,
    appData: appDataHash,
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  }
}

export function orderTypedData(chainId, order) {
  return { domain: cowDomain(chainId), types: ORDER_TYPES, primaryType: 'Order', message: order }
}

/** '0x' + 32 bayt; once domain ayiricisi sabit tabloyla dogrulanir. */
export function orderDigest(chainId, order) {
  domainSeparator(chainId)
  return TypedDataEncoder.hash(cowDomain(chainId), ORDER_TYPES, order)
}

/** '0x' + 56 bayt, kucuk harf: digest(32) || owner(20) || validTo(4, big-endian). */
export function orderUid(digest, owner, validTo) {
  if (typeof digest !== 'string' || !isHexString(digest, 32)) throw fail('INVALID_ORDER')
  if (!isValidTo(validTo)) throw fail('INVALID_ORDER')
  const sahip = toAddress(owner).toLowerCase()
  return concat([digest.toLowerCase(), sahip, toBeHex(validTo, 4)])
}

/** signer: { signTypedData } (ethers Wallet benzeri). Imzayi order.receiver a karsi dogrular. Anahtara dokunmaz. */
export async function signOrder(signer, chainId, order) {
  domainSeparator(chainId)
  const { domain, types, message } = orderTypedData(chainId, order)
  const imza = await signer.signTypedData(domain, types, message)
  if (typeof imza !== 'string' || imza.length !== 132 || !isHexString(imza, 65)) throw fail('SIGNATURE_MISMATCH')
  let kurtarilan
  try {
    kurtarilan = verifyTypedData(domain, types, message, imza)
  } catch {
    throw fail('SIGNATURE_MISMATCH')
  }
  if (kurtarilan.toLowerCase() !== String(order.receiver).toLowerCase()) throw fail('SIGNATURE_MISMATCH')
  return imza
}

/** POST /api/v1/orders govdesi; anahtar sirasi spec 6.4. quoteId yalniz tamsayi ise eklenir. appData DIZE gider. */
export function buildPostBody({ order, signature, quoteId, appDataJson, appDataHash }) {
  const govde = {
    sellToken: order.sellToken,
    buyToken: order.buyToken,
    receiver: order.receiver,
    sellAmount: order.sellAmount,
    buyAmount: order.buyAmount,
    validTo: order.validTo,
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
    signingScheme: 'eip712',
    signature,
    from: order.receiver,
  }
  if (Number.isInteger(quoteId)) govde.quoteId = quoteId
  govde.appData = appDataJson
  govde.appDataHash = appDataHash
  return govde
}

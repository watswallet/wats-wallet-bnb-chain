// CoW Protocol (xStocks Al/Sat) sabitleri: ag, adres, bps, sure, odeme tokenleri, permit tablosu, kilit nedenleri.
// Saf modul; ethers v6'dan yalniz getAddress ve ZeroAddress. Hicbir sabit calisma zamaninda degistirilemez.
// appCode BURADA DEGIL (K4): yalniz order.js'te tanimlanir.
import { getAddress, ZeroAddress } from 'ethers'

export const COW_CHAIN_IDS = Object.freeze([1, 56, 42161])
export const COW_API_BASE = 'https://api.cow.fi'
export const COW_PATH_BY_CHAIN = Object.freeze({ 1: 'mainnet', 56: 'bnb', 42161: 'arbitrum_one' })

// Tip kati: yalniz Number zincir kimligi; metin ('1') ve desteklenmeyen zincir null.
export const cowPathFor = (chainId) =>
  typeof chainId === 'number' && Object.hasOwn(COW_PATH_BY_CHAIN, chainId) ? COW_PATH_BY_CHAIN[chainId] : null

export const GPV2_SETTLEMENT = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'
// TEK harcayici: izinler (permit/approve) yalniz bu adrese verilir; arayuzden adres alinmaz.
export const GPV2_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

export const COW_DOMAIN_NAME = 'Gnosis Protocol'
export const COW_DOMAIN_VERSION = 'v2'

export function cowDomain(chainId) {
  const id = Number(chainId)
  if (cowPathFor(id) === null) {
    const err = new Error(`CoW desteklenmeyen zincir: ${String(chainId)}`)
    err.code = 'UNSUPPORTED_CHAIN'
    throw err
  }
  return {
    name: COW_DOMAIN_NAME,
    version: COW_DOMAIN_VERSION,
    chainId: id,
    verifyingContract: GPV2_SETTLEMENT,
  }
}

export const ISSUER_ASSET_URL = 'https://api.xstocks.fi/api/v2/public/assets/'

// Sayilar
export const ORDER_VALIDITY_SEC = 1800
export const PARTNER_FEE_BPS = 10
export const SLIPPAGE_BIPS = 50
export const PRICE_PROTECTION_BPS = 200
// 2026-10-21 kullanici karari: ag ucreti %2 fiyat korumasindan ayrildi ve cuzdan asgari tutar KILIDI koymaz.
// Ag ucreti (CoW feeAmount) emir degerinin bu yuzdesini asarsa YALNIZ uyari gosterilir (tam sinir uyarisiz).
export const NETWORK_FEE_WARN_PCT = 10
export const PERMIT_GAS_LIMIT = '100000'
export const QUOTE_DEBOUNCE_MS = 600
export const COW_TIMEOUT_MS = 10_000
export const COW_MIN_GAP_MS = 2000
export const COW_RETRY_DEFAULT_MS = 1500
export const POPUP_POLL_MS = 3000
export const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000
// K6: yalniz COW_APPROVE_* icin teklif onay penceresi (createdAt + 5 dk)
export const APPROVE_WINDOW_MS = 5 * 60 * 1000

export const LOCK_REASON = Object.freeze({
  PRICE_PROTECTION: 'PRICE_PROTECTION',
  REFERENCE_MISSING: 'REFERENCE_MISSING',
  MARKET_CLOSED: 'MARKET_CLOSED',
  MARKET_UNKNOWN: 'MARKET_UNKNOWN',
  FEE_DEBT: 'FEE_DEBT',
})

// Odeme tokenleri (Ek A.5); ondalik YOK (K5: zincirden okunur). permit: EIP-2612 destegi (Ek D).
const tok = (symbol, address, permit) => Object.freeze({ symbol, address, permit })
export const PAY_TOKENS = Object.freeze({
  1: Object.freeze([
    tok('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', true),
    tok('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', false),
  ]),
  56: Object.freeze([
    tok('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', false),
    tok('USDT', '0x55d398326f99059fF775485246999027B3197955', false),
  ]),
  42161: Object.freeze([
    tok('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', true),
    tok('USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', false),
  ]),
})

export const payTokensFor = (chainId) => PAY_TOKENS[chainId] ?? []

// Buyuk/kucuk harf duyarsiz; USDC.e vb. listede olmadigi icin null.
export function payTokenByAddress(chainId, address) {
  if (typeof address !== 'string') return null
  const a = address.toLowerCase()
  return payTokensFor(chainId).find((t) => t.address.toLowerCase() === a) ?? null
}

export const permitSupported = (chainId, address) => payTokenByAddress(chainId, address)?.permit === true

// Ucret alicisi: sirket Safe'i (2026-10-21 kullanici). Ethereum, BSC ve Arbitrum'da ayni adres, ayni sahipler, esik 2/3
// (v1.4.1, salt okuma ile dogrulandi). Gecersizse emir kurulmaz (guvenlik degismezi 9).
export const PARTNER_FEE_RECIPIENT = '0xb42f545bF8AB1A1Ba968e21a32E553d25fdF8e6d'

// Hicbir halde firlatmaz. ok icin: string, EIP-55 (getAddress(x) === x), sifir adres degil.
export function partnerRecipientCheck(recipient = PARTNER_FEE_RECIPIENT) {
  const MISSING = { ok: false, code: 'PARTNER_FEE_RECIPIENT_MISSING' }
  if (typeof recipient !== 'string') return MISSING
  try {
    if (getAddress(recipient) !== recipient) return MISSING
  } catch {
    return MISSING
  }
  if (recipient === ZeroAddress) return MISSING
  return { ok: true, recipient }
}

// --- Faz 3: ATS ile ag ucreti (spec 3, 5, 6) ---
export const ATS_FEE_CHAINS = Object.freeze([1, 56, 42161]) // tek satirla [1]e indirilebilir
export const FEE_BSC_CHAIN_ID = 56 // ucret her zaman BSC'de odenir
export const FEE_OP_KIND = 'cowFee'
export const FEE_READY_BALANCE_BPS = 12000n // hazirlik: bakiye >= ucret x %120
export const FEE_DRIFT_BPS = 12500n // tahsilat: ucret <= quotedAtsRaw x 1,25
export const FEE_RETRY_MAX = 6 // ayni nonce ile en fazla 6 deneme
export const FEE_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000
export const FEE_STUCK_MARK_MS = 30 * 24 * 60 * 60 * 1000 // cozulmemis ucret 30 gunde FEE_STUCK
export const FEE_NO_SERVICE_MS = 10 * 60 * 1000 // servis arizasi istisnasi esigi
export const FEE_SETTLE_QUEUE_WAIT_MS = 30_000
export const FEE_PREPARE_TIMEOUT_MS = 4000 // service.js fee.prepare zaman asimi (asilirse mode 'none')
export const LOW_NETWORK_FEE_CHAINS = Object.freeze([56, 42161]) // netNote yalniz agi ucreti < 1 $ olan zincirlerde
export const REFUND_CLAIM_BACKOFF_MS = Object.freeze([60_000, 300_000, 1_800_000])
export const REFUND_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000
export const REFUND_POLL_MIN_MS = 60_000
export const REFUND_APPROVED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const REFUND_CLAIMING_STALE_MS = 120_000
export const REFUND_CLAIM_PATH = '/cow/refund-claim'

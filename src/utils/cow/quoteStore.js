// Teklif kaydi deposu (chrome.storage.session): tek kullanimlik, sureli, hesaba bagli (spec 5.5, K6, K7, K12).
// Imzalanan yapinin TEK kaynagi bu kayittir; arayuz buraya sayi sokamaz (Review Focus 2).
// Kayitta BigInt yok: tutarlar ondalik dizedir (session BigInt serilestiremez).
import { codedError, COW_ERROR } from './errors'

export const QUOTE_KEY_PREFIX = 'cow_quote_'
export const QUOTE_GC_GRACE_MS = 60_000

const ID_RE = /^[0-9a-f]{32}$/
const DIGITS = /^\d+$/
const AMOUNT_FIELDS = ['sellAmount', 'expectedBuy', 'minBuy']
const TIME_FIELDS = ['createdAt', 'expiresAt', 'approveUntil']

// Varsayilan depo cagri aninda cozulur (testte chrome tanimsiz olabilir).
const sessionStore = (storage) => storage ?? globalThis.chrome?.storage?.session

export function newQuoteId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const keyOf = (quoteId) => QUOTE_KEY_PREFIX + quoteId

// BigInt ve fonksiyon icin derin tarama (dongusuz veri varsayilir; sinir 20 kat).
function hasUnsafeValue(value, depth = 0) {
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') return true
  if (depth > 20) return true
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => hasUnsafeValue(v, depth + 1))
  }
  return false
}

function assertShape(record) {
  const bad = (why) => codedError(COW_ERROR.INVALID_REQUEST, why)
  if (!record || typeof record !== 'object') throw bad('record')
  if (typeof record.quoteId !== 'string' || !ID_RE.test(record.quoteId)) throw bad('quoteId')
  if (hasUnsafeValue(record)) throw bad('unsafe')
  for (const f of AMOUNT_FIELDS) {
    if (typeof record[f] !== 'string' || !DIGITS.test(record[f])) throw bad(f)
  }
  if (!Number.isInteger(record.cowQuoteId)) throw bad('cowQuoteId')
  for (const f of TIME_FIELDS) {
    if (!Number.isFinite(record[f])) throw bad(f)
  }
}

export async function saveQuote(record, { storage, now = Date.now() } = {}) {
  assertShape(record)
  const st = sessionStore(storage)
  await st.set({ [keyOf(record.quoteId)]: record })
  await pruneQuotes(now, { storage: st })
}

export async function getQuote(quoteId, { storage } = {}) {
  if (typeof quoteId !== 'string' || !ID_RE.test(quoteId)) return null
  const key = keyOf(quoteId)
  const out = await sessionStore(storage).get(key)
  return out?.[key] ?? null
}

/** Saf. null = gecerli; aksi COW_ERROR kodu. window 'place' | 'approve'. */
export function checkQuote(record, { activeAddress, now, window } = {}) {
  if (window !== 'place' && window !== 'approve') return COW_ERROR.INVALID_REQUEST
  // now sonlu sayi degilse `now >= expiresAt` hep false olur ve sure kontrolu sessizce gecerdi: fail-closed
  if (typeof now !== 'number' || !Number.isFinite(now)) return COW_ERROR.INVALID_REQUEST
  if (!record || typeof record !== 'object') return COW_ERROR.QUOTE_NOT_FOUND
  if (record.consumed) return COW_ERROR.QUOTE_USED
  if (typeof activeAddress !== 'string' || typeof record.owner !== 'string' || activeAddress.toLowerCase() !== record.owner.toLowerCase()) {
    return COW_ERROR.ACCOUNT_CHANGED
  }
  if (window === 'place') {
    if (record.locked) return COW_ERROR.QUOTE_LOCKED
    // Izin yokken CoW'a giden emir dolmaz; tuketilmez (K7)
    if (record.approval?.mode === 'onchain') return COW_ERROR.APPROVAL_REQUIRED
    if (now >= record.expiresAt) return COW_ERROR.QUOTE_EXPIRED
    return null
  }
  // approve penceresi: K6 (createdAt + 5 dk)
  if (now >= record.approveUntil) return COW_ERROR.QUOTE_EXPIRED
  // gereksiz izin imzasi/islemi istenemez
  if (record.locked || record.approval?.mode !== 'onchain') return COW_ERROR.INVALID_REQUEST
  return null
}

// Modul ici seri kilit: kontrol + consumed yazimi arasina baska claim giremez (K7).
let claimChain = Promise.resolve()

/** COW_PLACE_ORDER icin: kontrol + consumed=true yazimi TEK adimda. */
export function claimQuote({ quoteId, activeAddress, now = Date.now(), storage } = {}) {
  const run = async () => {
    const st = sessionStore(storage)
    const record = await getQuote(quoteId, { storage: st })
    const code = checkQuote(record, { activeAddress, now, window: 'place' })
    if (code) return { ok: false, code }
    const claimed = { ...record, consumed: true }
    await st.set({ [keyOf(claimed.quoteId)]: claimed })
    return { ok: true, record: claimed }
  }
  const result = claimChain.then(run, run)
  claimChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** COW_APPROVE_* icin: tuketmez, 'approve' penceresi. */
export async function peekQuoteForApprove({ quoteId, activeAddress, now = Date.now(), storage } = {}) {
  const record = await getQuote(quoteId, { storage })
  const code = checkQuote(record, { activeAddress, now, window: 'approve' })
  return code ? { ok: false, code } : { ok: true, record }
}

/** Suresi (iki sureden gec olani) + 60 sn gecenleri siler; yalniz cow_quote_ onekli anahtarlar. */
export async function pruneQuotes(now, { storage } = {}) {
  const st = sessionStore(storage)
  const all = (await st.get(null)) ?? {}
  const expired = Object.keys(all).filter((key) => {
    if (!key.startsWith(QUOTE_KEY_PREFIX)) return false
    const r = all[key]
    const limit = Math.max(Number(r?.expiresAt) || 0, Number(r?.approveUntil) || 0)
    return now > limit + QUOTE_GC_GRACE_MS
  })
  if (expired.length) await st.remove(expired)
}

// CoW marketGate: teklif ONCESI kapilar (saf: ag yok, saat yok, modul durumu yok).
//  - ihracci piyasa kapisi (K2: verify-xstocks-core.mjs'teki tradingGate'in KOPYASI; marketGate.test.js
//    betigi import edip ayni girdilerde ayni sonucu verdigini kilitler)
//  - Al/Sat kilit kurali (K1): referans yoksa ikisi kilitli; piyasa kapali/bilinmiyorsa yalniz Al kilitli.
// Kapali piyasada CoW 200 + sisken fiyat doner (Review Focus 1): piyasa durumu CoW'dan degil ihracci
// API'sinden okunur ve kilitliyken CoW'a hic gidilmez. Bayraktan BAGIMSIZ (feature bayragi import edilmez).
import { LOCK_REASON } from './config'

/** verify-xstocks-core.mjs ile AYNI govde (K2 kopya). Zarflar: ham / data / asset / dizi. */
export function extractTrading(body) {
  const adaylar = [body, body?.data, body?.asset, Array.isArray(body) ? body[0] : null, Array.isArray(body?.data) ? body.data[0] : null]
  for (const aday of adaylar) {
    if (aday && typeof aday === 'object' && aday.trading && typeof aday.trading === 'object') return aday.trading
  }
  return null
}

// Gecerli donemin siparis ust limiti: sayi degilse (alan yok, null, bos, cozulemeyen metin) null.
function periodLimit(trading, period) {
  const raw = period ? trading.limitsPerPeriod?.[period]?.maxOrderFiatValue : undefined
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * AYNI kural: ACIK = openNow === true VE gecerli donem limiti > 0. Baska her durum ACIK DEGILDIR:
 * acikca kapali -> PIYASA_KAPALI; celiski/eksik alan -> PIYASA_DURUMU_BELIRSIZ; trading yok -> TRADING_BILGISI_YOK.
 * @returns {{open: boolean, reason: null|'PIYASA_KAPALI'|'PIYASA_DURUMU_BELIRSIZ'|'TRADING_BILGISI_YOK', period: string|null, nextChangeAt: string|null}}
 */
export function tradingGate(trading) {
  if (!trading || typeof trading !== 'object') {
    return { open: false, reason: 'TRADING_BILGISI_YOK', period: null, nextChangeAt: null }
  }
  const period = typeof trading.currentPeriod === 'string' ? trading.currentPeriod : null
  const nextChangeAt = trading.nextChangeAt ?? null
  const limit = periodLimit(trading, period)

  if (trading.openNow === false || limit === 0) {
    return { open: false, reason: 'PIYASA_KAPALI', period, nextChangeAt }
  }
  if (trading.openNow === true && limit !== null && limit > 0) {
    return { open: true, reason: null, period, nextChangeAt }
  }
  return { open: false, reason: 'PIYASA_DURUMU_BELIRSIZ', period, nextChangeAt }
}

// Arayuz tarih bicimlemesi cokmesin: yalniz Date.parse sonlu ise doner.
function safeNextChange(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  return Number.isFinite(Date.parse(value)) ? String(value) : null
}

// Hata firlatan / bozuk girdi piyasayi ACIK saymaz: belirsiz kapi.
function safeGate(trading) {
  try {
    return tradingGate(trading)
  } catch {
    return { open: false, reason: 'TRADING_BILGISI_YOK', period: null, nextChangeAt: null }
  }
}

/**
 * Arayuz bilgi satiri icin (Sat ekraninda kapaliyken).
 * @returns {{state: 'open'|'closed'|'unknown', nextChangeAt: string|null}}
 */
export function marketNotice(trading) {
  const gate = safeGate(trading)
  if (gate.open) return { state: 'open', nextChangeAt: null }
  if (gate.reason === 'PIYASA_KAPALI') return { state: 'closed', nextChangeAt: safeNextChange(gate.nextChangeAt) }
  return { state: 'unknown', nextChangeAt: null }
}

/**
 * null = kilit yok. Sira: (a) side dogrulamasi, (b) Al'da piyasa, (c) referans (Al VE Sat).
 * Al'da piyasa referanstan once degerlendirilir: kapali piyasada acilis saati "fiyat dogrulanamiyor"dan
 * daha yararlidir. Sat'ta piyasa hicbir durumda kilit nedeni DEGILDIR.
 * @returns {null | {code: 'REFERENCE_MISSING'|'MARKET_CLOSED'|'MARKET_UNKNOWN', nextChangeAt: string|null}}
 */
export function preQuoteLock({ side, trading, reference } = {}) {
  if (side !== 'buy' && side !== 'sell') {
    const err = new Error('side buy ya da sell olmali')
    err.code = 'INVALID_REQUEST'
    throw err
  }
  if (side === 'buy') {
    const gate = safeGate(trading)
    if (gate.open !== true) {
      if (gate.reason === 'PIYASA_KAPALI') {
        return { code: LOCK_REASON.MARKET_CLOSED, nextChangeAt: safeNextChange(gate.nextChangeAt) }
      }
      return { code: LOCK_REASON.MARKET_UNKNOWN, nextChangeAt: null }
    }
  }
  if (typeof reference !== 'number' || !isFinite(reference) || reference <= 0) {
    return { code: LOCK_REASON.REFERENCE_MISSING, nextChangeAt: null }
  }
  return null
}

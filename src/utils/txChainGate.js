// Arka arkaya gonderim kapisi: ayni hesap + zincirde onceki islem HENUZ hash'e ulasmadiysa yeni gonderim reddedilir.
// Saf yardimci (storage okumaz/yazmaz): cagiran current_transactions listesini verir.
//
// Kural:
//  - EVM / ATS: onceki kart 'queued' veya hash'siz 'processing' ise RED; hash'li 'processing' ise IZIN
//    (EVM nonce'u 'pending'den alir; ATS'te ikinci islem kuyrukta makbuza kadar bekler).
//  - TON: seqno hash tasimaz, bekleyen (5 dk icinde) her TON karti reddeder (hasPendingTonTx).
//  - Yalniz kendi kartindan ONCE yazilan (timestamp'i kucuk) kartlar sayilir; kendi karti yoksa hepsi sayilir.
//  - KENDI KAYDI HARIC: updateTxStatus kendi 'queued' kartimizi yazar; kendi kartina takilmaz.
//  - Hash'siz kart yalniz yas siniri ICINDE sayilir (SW olurse sonsuz kilit olmaz); timestamp'siz kart saymaz.
//  - Hesap suzmesi: kartin accountKey'i ile ayni hesap sayilir; etiketsiz (null) eski kart guvenli yone dusulur (sayilir).
import { isTon } from './chainKind'
import { hasPendingTonTx } from './ton/tonPending'

export const GATE_NO_HASH_MS = 5 * 60 * 1000 // pendingRecovery.STUCK_NO_HASH_MS ile ayni

const PENDING = new Set(['queued', 'processing'])

/**
 * @param {Array} cards   current_transactions
 * @param {{txId:string, accountKey:string|null, chainId:number, ats?:boolean, now?:number}} q
 * @returns {boolean} true = gonderim reddedilmeli
 */
export function isChainBlocked(cards, { txId, accountKey, chainId, now = Date.now() }) {
  if (!Array.isArray(cards)) return false
  // Yalniz kendi kartimizdan ONCE yazilan kartlar sayilir: sonradan kuyruga giren kart bizim onumuzde degil.
  const own = cards.find((t) => t && t.id === txId)
  const ownTs = typeof own?.timestamp === 'number' ? own.timestamp : null
  const mine = cards.filter((t) => {
    if (!t || t.id === txId) return false
    if (ownTs != null && typeof t.timestamp === 'number' && t.timestamp >= ownTs) return false
    if (!PENDING.has(t.status)) return false
    if (t.accountKey != null && t.accountKey !== accountKey) return false
    return (t.meta?.chainId ?? t.chainId) === chainId
  })
  if (isTon(chainId)) return hasPendingTonTx(mine, now)
  return mine.some((t) => {
    if (typeof t.timestamp !== 'number') return false
    if (t.status === 'processing' && t.meta?.txHash) return false // hash'li: EVM/ATS'te izin
    return now - t.timestamp < GATE_NO_HASH_MS
  })
}

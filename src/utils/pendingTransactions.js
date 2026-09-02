/**
 * `pending_transactions` icin tek gecerli degismez (invariant):
 *   listede duran bir kayit = zincirde HENUZ onaylanmamis islem.
 *
 * Gosterilen bakiye, zincirden okunan gercek bakiyeden bu kayitlarin tutarini duser
 * ("golge bakiye"), cunku zincir gonderiyi henuz yansitmamistir. Normal akista
 * saveOrUpdateTxInStorage islem cozulunce kaydi listeden siler ve denge korunur.
 *
 * Kurtarma yolu (background.checkAndRecoverPendingTxs) ise kaydi silmeden yalnizca
 * receipt_status'u guncelliyordu: zincir gonderiyi zaten yansitmisken dusum devam
 * ettigi icin bakiye KALICI olarak eksik gorunuyordu. Asagidaki fonksiyonlar hem
 * cozulmus hem de artik cozulemeyecek kadar eskimis kayitlari eler.
 */

// Bir islem 24 saat sonra ya madenlenmistir ya da mempool'dan dusmustur; iki
// durumda da zincirdeki bakiye guncel demektir. Zincir kimligi bulunamadigi icin
// hic cozulemeyen kayitlarin sonsuza dek dusulmesini bu tavan engelliyor.
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function isResolved(tx) {
    if (!tx) return true
    return !!tx.receipt_status && tx.receipt_status !== 'pending'
}

export function isExpired(tx, now = Date.now(), maxAgeMs = PENDING_MAX_AGE_MS) {
    if (!tx || !tx.block_timestamp) return false
    const started = Date.parse(tx.block_timestamp)
    if (Number.isNaN(started)) return false
    return (now - started) > maxAgeMs
}

export function isStillPending(tx, now = Date.now(), maxAgeMs = PENDING_MAX_AGE_MS) {
    return !isResolved(tx) && !isExpired(tx, now, maxAgeMs)
}

export function prunePendingTransactions(list, now = Date.now(), maxAgeMs = PENDING_MAX_AGE_MS) {
    if (!Array.isArray(list)) return []
    return list.filter(tx => isStillPending(tx, now, maxAgeMs))
}

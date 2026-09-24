/**
 * Otomatik kilit suresi.
 *
 * Ayar (`lock_timer`) DAKIKA cinsinden saklanir; LockTimer.vue su degerleri yazar:
 *   0  -> hemen (popup kapaninca)
 *   1 / 5 / 10 / 30 / 60 -> dakika
 *   -1 -> asla
 *
 * Bu deger hicbir yerde okunmuyordu: background sabit 15 dakikaya gore kilitliyordu,
 * yani "Asla" ve "Hemen" dahil her secenek sessiz bir no-op'tu.
 */
export const DEFAULT_LOCK_TIMER_MINUTES = 15
export const LOCK_NEVER = -1
export const LOCK_IMMEDIATE = 0

export function normalizeLockTimer(lockTimer) {
    // Number(null) ve Number('') SIFIR dondurur; kontrol edilmezse ayari olmayan
    // kullanici "Hemen kilitle" secmis gibi davranilir.
    if (lockTimer === null || lockTimer === undefined || lockTimer === '') {
        return DEFAULT_LOCK_TIMER_MINUTES
    }

    const minutes = Number(lockTimer)
    if (!Number.isFinite(minutes)) return DEFAULT_LOCK_TIMER_MINUTES
    if (minutes < 0) return LOCK_NEVER
    return minutes
}

export function shouldLock(lockTimer, lastActiveTime, now = Date.now()) {
    const minutes = normalizeLockTimer(lockTimer)
    if (minutes === LOCK_NEVER) return false

    // "Hemen" bir SURE DEGIL, bir OLAYdir: son acik arayuz kapandiginda kilitle.
    // Kararin sahibi utils/uiRegistry.js; alarm dali burada cekilir.
    //
    // SIRA ONEMLI: bu kontrol asagidaki `!lastActiveTime -> true` guvenli-taraf
    // kuralindan ONCE gelir, cunku o kural "ne zamandir acik bilinmiyorsa
    // kilitle" der -- LOCK_IMMEDIATE'te ise sure zaten OLCULMUYOR.
    //
    // normalizeLockTimer'in null/undefined/'' elemesinden SONRA gelir: ayati
    // olmayan kullanici 15 dakika varsayilanindadir, "Hemen" secmis DEGILDIR.
    if (minutes === LOCK_IMMEDIATE) return false

    // Etkinlik damgasi yoksa oturumun ne zamandir acik oldugu bilinemez: guvenli
    // taraf kilitlemektir.
    if (!lastActiveTime) return true

    return (now - lastActiveTime) > minutes * 60 * 1000
}

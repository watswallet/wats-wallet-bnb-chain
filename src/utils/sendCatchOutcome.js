import { userErrorKey, isNetworkError } from './userError'

// Gonderim catch'inin kullaniciya yansiyacak sonucu.
//  - broadcastDone (arka plan basari yaniti dondu): islem GONDERILDI; sonrasi adimdaki
//    hata 'basarisiz' diye gosterilmez ('sent', anahtar yok).
//  - broadcastStarted (SEND istegi cikti, yanit gelmedi) + ag sinifi hata: islem gitmis olabilir -> 'unknown' (amber durum karti).
//  - digerleri: kesin red -> 'failed' (kirmizi alan).
export function sendCatchOutcome(err, broadcastDone, broadcastStarted = false) {
    if (broadcastDone) return { kind: 'sent', key: null }
    // Yayin istegi HIC gonderilmediyse (build/estimateGas/fiyat asamasi) islem gitmemistir:
    // belirsiz degil, kesin red ('gonderilmis olabilir' metni yalan olurdu).
    if (isNetworkError(err)) {
        return broadcastStarted
            ? { kind: 'unknown', key: 'send.errors.network' }
            : { kind: 'failed', key: 'send.confirmTransaction.txFailed' }
    }
    return { kind: 'failed', key: userErrorKey(err) }
}

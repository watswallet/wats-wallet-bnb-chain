// Daha once BASARIYLA gonderdigin alicilar.
//
// Zehirli adres tespitinin en kritik kaynagi burasidir: klasik saldiri, kullanicinin
// adres defterine KAYDETMEDIGI bir adrese (borsa yatirma adresi gibi) ikinci kez
// gonderirken olur. Yalnizca hesaplar + adres defteri ile kiyaslamak bu deseni kacirir.
//
// EVM'e ozel DEGILDIR: adres karsilastirmasi addressForm.js'teki PAYLASILAN
// dedupeKey()'e dayanir. Bu dosyanin kendi EVM-only regex'i olsaydi (nitekim
// bir sure OYLEYDI), her Solana alicisi burada SESSIZCE atilirdi: buildTrustedList
// icin tek kaynak gecmis kalir, gecmisin kendi emniyet valfi ise saldirganin
// AYNI gecmise dustugu bir ikizle kolayca alt edilebilir (bkz. addressPoisoning.js
// valf 2 yorumu) — "sent" tam da bu valften ETKILENMEYEN kaynaktir.
//
// Yazmalar txStorage kuyrugundan gecer: popup ile background ayni anahtara yazip
// birbirinin degisikligini ezmesin.

import { withStorageList } from './txStorage'
import { dedupeKey } from './addressForm'

export const SENT_RECIPIENTS = 'sent_recipients'

// Depo sismesin. 200 kayit, gercek kullanimda yillarca yeter; en eski duser.
export const MAX_SENT_RECIPIENTS = 200

// Saf: listeyi degistirmez, yenisini doner. En son gonderilen basta durur.
export function upsertRecipient(list, { address, label = null, at = 0 } = {}) {
    const current = Array.isArray(list) ? list : []
    const key = dedupeKey(address)
    if (!key) return current

    const previous = current.find(r => dedupeKey(r?.address) === key)
    // Adresi cozulemeyen kayitlar YAZARKEN elenir: depoda bir kez bozulmus bir girdi
    // sonsuza dek tavandan yer yemesin, tespit listesini de kirletmesin.
    const rest = current.filter(r => dedupeKey(r?.address) && dedupeKey(r.address) !== key)

    const entry = {
        // Kayitli yazim korunur: adres bir kez checksum case ile girildiyse oyle kalir.
        address: previous?.address ?? address,
        // Etiket yoksa eskisini SILME — bu gonderim dapp'ten gelmis olabilir.
        label: label ?? previous?.label ?? null,
        lastSentAt: at,
        count: (previous?.count ?? 0) + 1
    }

    return [entry, ...rest].slice(0, MAX_SENT_RECIPIENTS)
}

export async function getSentRecipients() {
    const result = await chrome.storage.local.get(SENT_RECIPIENTS)
    const list = result?.[SENT_RECIPIENTS]
    return Array.isArray(list) ? list : []
}

export function recordSentRecipient(address, label = null, at = Date.now()) {
    return withStorageList(SENT_RECIPIENTS, list => upsertRecipient(list, { address, label, at }))
}

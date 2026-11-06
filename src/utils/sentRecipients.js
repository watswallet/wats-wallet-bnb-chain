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
// GIZLI MOD (spec 7.3 ile ayni sinif): liste TARAFA gore ayrilir. Her kayit yazildigi
// anda gonderenin tarafiyla etiketlenir (Gizli Hesap gonderdiyse `private: true`;
// normal tarafta alan HIC yazilmaz, eski kayitlarla ayni bicim). Okuyucular yalniz
// kendi tarafini gorur: normal mod Gizli Hesap'in alicilarini (adres defteri
// onerileri, zehirli adres uyarisinin tam adresi) hicbir yerde gostermez ve tersi.
// Etiketsiz eski kayit gizli moddan once yazilmistir -> normal taraftir.
//
// Yazmalar txStorage kuyrugundan gecer: popup ile background ayni anahtara yazip
// birbirinin degisikligini ezmesin.

import { withStorageList } from './txStorage'
import { dedupeKey } from './addressForm'

export const SENT_RECIPIENTS = 'sent_recipients'

// Depo sismesin. 200 kayit, gercek kullanimda yillarca yeter; en eski duser.
export const MAX_SENT_RECIPIENTS = 200

const isPrivateEntry = (r) => r?.private === true

// Saf: yalniz istenen tarafin kayitlari. `privateActive` true ise gizli taraf, aksi halde
// normal taraf (etiketsiz eski kayitlar dahil).
export function sentForSide(list, privateActive) {
    const current = Array.isArray(list) ? list : []
    return current.filter(r => isPrivateEntry(r) === !!privateActive)
}

// Saf: listeyi degistirmez, yenisini doner. En son gonderilen basta durur.
// `private`: gonderen Gizli Hesap mi. AYNI adres iki tarafta AYRI kayit olur (sayac ve
// etiket taraflar arasi sizmasin).
export function upsertRecipient(list, { address, label = null, at = 0, private: isPrivate = false } = {}) {
    const current = Array.isArray(list) ? list : []
    const key = dedupeKey(address)
    if (!key) return current

    const sameSide = (r) => isPrivateEntry(r) === !!isPrivate
    const previous = current.find(r => dedupeKey(r?.address) === key && sameSide(r))
    // Adresi cozulemeyen kayitlar YAZARKEN elenir: depoda bir kez bozulmus bir girdi
    // sonsuza dek tavandan yer yemesin, tespit listesini de kirletmesin.
    const rest = current.filter(r => dedupeKey(r?.address) && !(dedupeKey(r.address) === key && sameSide(r)))

    const entry = {
        // Kayitli yazim korunur: adres bir kez checksum case ile girildiyse oyle kalir.
        address: previous?.address ?? address,
        // Etiket yoksa eskisini SILME — bu gonderim dapp'ten gelmis olabilir.
        label: label ?? previous?.label ?? null,
        lastSentAt: at,
        count: (previous?.count ?? 0) + 1,
        ...(isPrivate ? { private: true } : {})
    }

    return [entry, ...rest].slice(0, MAX_SENT_RECIPIENTS)
}

// Yalniz istenen tarafin kayitlari doner. `private` verilmezse NORMAL taraf: bir
// okuyucu tarafi unutursa bile gizli kayit kendiliginden sizmaz.
export async function getSentRecipients({ private: isPrivate = false } = {}) {
    const result = await chrome.storage.local.get(SENT_RECIPIENTS)
    return sentForSide(result?.[SENT_RECIPIENTS], isPrivate)
}

export function recordSentRecipient(address, label = null, at = Date.now(), { private: isPrivate = false } = {}) {
    return withStorageList(SENT_RECIPIENTS, list => upsertRecipient(list, { address, label, at, private: isPrivate }))
}

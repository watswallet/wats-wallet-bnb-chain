// TON ucret uclarina (quote/relay) HTTP katmani. Bu modul KARAR VERMEZ - hata
// govdesini/kodunu TonFeeError'a tasir, eslestirme Task 3'un isi
// (tonFeeBlocker.js, resolveTonFeeBlocker). tonFeeQuote sunucu govdesini
// OLDUGU GIBI dondurur: Task 2'nin dogrulama kapisi (tonQuoteVerify.js)
// payloadBoc'tan hash yeniden turetip sign.* ile karsilastiriyor, burada
// yapilacak herhangi bir normallestirme o karsilastirmayi bozar.
import { tonFeePaymasterBase } from './tonFeeConfig'

/**
 * Sunucunun /paymaster/ton/quote ve /paymaster/ton/relay uclarindan donen
 * hata. `code`/`httpStatus`/`phase` resolveTonFeeBlocker'in (tonFeeBlocker.js,
 * Task 3) girdisidir; `receipt`/`settlementId` 502 sonrasi "odendi ama
 * gitmedi" kurtarma akisinindir (design bolum 6) - tasinmazlarsa odenmis bir
 * ucretin tek kaniti kaybolur.
 */
export class TonFeeError extends Error {
    constructor(message, { code = null, httpStatus = null, phase = null, receipt = null, settlementId = null } = {}) {
        super(message)
        this.name = 'TonFeeError'
        this.code = code
        this.httpStatus = httpStatus
        this.phase = phase
        this.receipt = receipt
        this.settlementId = settlementId
    }
}

// EKLENTI FARKI (bkz. sdk/gasless.ts GaslessClient.parse): backend'in
// onundeki CDN 502/503/524'te govde HTML doner. Durum kodundan ONCE
// JSON.parse cagirmak bu durumda SyntaxError atar ve gercek HTTP durumu
// kaybolur - once metin, sonra korumali parse.
async function parseJsonBody(res) {
    const raw = await res.text()
    try { return raw ? JSON.parse(raw) : null } catch { return null }
}

async function post(path, body, phase) {
    const base = tonFeePaymasterBase()
    let res
    try {
        res = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })
    } catch (e) {
        // Ham TypeError (fetch reddi/DNS/CORS) cagirana asla sizmaz -
        // resolveTonFeeBlocker yalniz TonFeeError okur.
        throw new TonFeeError(e && e.message ? e.message : 'ag hatasi', { phase })
    }

    const json = await parseJsonBody(res)
    if (!res.ok) {
        throw new TonFeeError((json && json.error) || `HTTP ${res.status}`, {
            code: (json && json.code) ?? null,
            httpStatus: res.status,
            phase,
            // 502 govdesindeki makbuz burada TASINIR ve diske yazilir (design 6).
            // NE ISE YARAR: ucretin alindigina dair KANIT - kullaniciya gosterilen
            // destek kaydinin (`settlementId` ile birlikte) dayanagi. NE ISE
            // YARAMAZ: tekrar denemenin govdesine GIRMEZ - asagidaki tonFeeRelay
            // yalniz { quoteId, signature, feeAuthSignature } gonderir ve gondermemek
            // bilincli (bkz. o fonksiyonun notu, tasarim 10 R1).
            receipt: (json && json.receipt) ?? null,
            settlementId: (json && json.settlementId) ?? null,
        })
    }
    return json
}

/**
 * POST /paymaster/ton/quote. `body` = { tonWallet, tonPublicKey, payer,
 * actions } (olculen sekil, design 2.2) - AYNEN gonderilir, alan adi
 * degistirilmez.
 */
export function tonFeeQuote(body) {
    return post('/paymaster/ton/quote', body, 'quote')
}

/**
 * POST /paymaster/ton/relay.
 *
 * TEL UZERINDEKI AD `feeSignature` (OLCULDU 2026-09-01, canli). Onceki varsayim
 * `feeAuthSignature` idi ve sunucu o alani HIC OKUMUYORDU; okumadigi icin de
 * yanilti bir uzunluk hatasi veriyordu:
 *   400 "ucret yetkisi imzasi 65 bayt (r||s||v) ya da 64 bayt (EIP-2098) olmali"
 * -- oysa gonderilen deger TAM 65 bayt, gecerli hex, v=0x1b idi. Bir sure `0x`
 * onekinin soyulmadigi sanildi (Buffer.from('0x..','hex') 0 bayt doner ve AYNI
 * belirtiyi uretir); backend mesaji netlestirince gercek sebep gorundu:
 *   {"code":"ton-fee-auth-signature-missing",
 *    "error":"`feeSignature` alani eksik -- imza govdede bu adla gonderilmeli"}
 * Bu yuzden deger DOKUNULMADAN, `0x` onegiyle gecer: sunucunun hex isleyisi
 * hakkinda hicbir sey kanitlanmadi ve ethers'in standart ciktisini degistirmek
 * icin sebep yok.
 *
 * IC AD BILEREK `feeAuthSignature` KALDI: cagiranlar (tonFeeRelayer,
 * tonFeeRecovery) ve DISKTEKI makbuz bu adi kullaniyor. Ic adi da degistirmek
 * kayitli makbuzlari okunamaz kilar ve odenmis bir ucretin kurtarma yolunu
 * koparir. Cevrim TEK yerde, tam burada.
 *
 * GOVDE UC ALANDAN IBARET ve fazlasi SESSIZCE DUSER: parametre yikildigi icin
 * cagiranin verdigi baska bir alan istege HIC girmez. `receipt` de bu yuzden
 * GITMEZ - saklanir ama gonderilmez (bkz. tonFeeRecovery.retryRelay). Uydurulmus
 * bir alan adi eklemek, sunucu tanimadigi alanda istegin TAMAMINI reddettigi icin
 * ucreti zaten alinmis bir kaydin son tekrar hakkini yakardi.
 */
export function tonFeeRelay({ quoteId, signature, feeAuthSignature }) {
    return post('/paymaster/ton/relay', { quoteId, signature, feeSignature: feeAuthSignature }, 'relay')
}

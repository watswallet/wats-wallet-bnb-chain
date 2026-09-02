// TON ucret sponsorlugunun ACIK olup olmadigini sunucudan sorar
// (paymaster /status ucu). Sunucunun TON chainId'si istemcininkinden (-239)
// FARKLI bir sayidir (design 2026-08-29, bolum 4) - o sayiyi burada
// eslestirmek, sunucu numarayi degistirdiginde sessizce yanlis bolgeyi
// acardi. Bolge karari asagida tonFeeRelayActive'de, TAMAMEN yanitin
// .ton blogundan verilir.
import { TonFeeError } from './tonFeeClient'
import { tonFeePaymasterBase } from './tonFeeConfig'

// GET her zaman BSC'nin /paymaster/status ucuna gider - buradaki chainId
// tahsilatin yapildigi zincirdir, TON'un DEGIL.
const STATUS_CHAIN_ID = 56

// Ekrani her acilista /status'a gitmek gereksiz (bkz. atsPaymaster.js'teki
// ayni desen). 30 sn onay ekraninda gecirilen sureden uzun, onboarding
// sonrasi bayat kalacak kadar da degil.
const STATUS_TTL_MS = 30_000
const statusCache = new Map()

// EKLENTI FARKI (bkz. sdk/gasless.ts GaslessClient.parse): backend'in
// onundeki CDN 502/503'te govde HTML doner. Durum kodundan ONCE JSON.parse
// cagirmak bu durumda SyntaxError atar ve gercek HTTP durumu kaybolur -
// once metin, sonra korumali parse.
async function parseJsonBody(res) {
    const raw = await res.text()
    try { return raw ? JSON.parse(raw) : null } catch { return null }
}

/**
 * @param {{sender: string, force?: boolean}} args  `sender` BSC'deki EVM
 *   adresidir (0x...); sunucu onsuz 400 doner (olculdu), bu yuzden sender
 *   yokken AG CAGRISI YAPILMADAN firlatilir.
 * @returns {Promise<object>} sunucunun /status govdesi, OLDUGU GIBI (solana/
 *   budget dahil - bu gorev onlara dokunmaz).
 */
export async function readTonFeeStatus({ sender, force = false } = {}) {
    if (!sender) throw new Error('readTonFeeStatus: sender zorunlu (sunucu onsuz 400 doner)')

    const key = String(sender)
    const hit = statusCache.get(key)
    if (!force && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value

    const base = tonFeePaymasterBase()
    const url = `${base}/paymaster/status?chainId=${STATUS_CHAIN_ID}&sender=${encodeURIComponent(sender)}`
    let res
    try {
        res = await fetch(url)
    } catch (e) {
        // tonFeeClient.js'teki post() ile AYNI sarmalama: ham TypeError (fetch
        // reddi/DNS/CORS) buradan sizarsa Task 6'nin relayer'i ve Task 8'in
        // composable'i (readTonFeeStatus'u ilk cagiran ikisi) phase/code
        // okuyamaz ve resolveTonFeeBlocker'a hic ulasamaz. `phase: 'status'`
        // yeni bir deger - resolveTonFeeBlocker (tonFeeBlocker.js) bilinmeyen
        // phase'i zaten kodsuz-varsayilan dala dusurdugu icin orada bir
        // degisiklik gerekmiyor.
        throw new TonFeeError(e && e.message ? e.message : 'ag hatasi', { phase: 'status' })
    }
    const body = await parseJsonBody(res)
    if (!res.ok) {
        // 2xx disi bir HTTP yaniti da (ornegin CDN'den donen bir 500)
        // ayni tipe sarilir - tonFeeClient.js'teki POST'larla SIMETRIK.
        throw new TonFeeError((body && body.error) || `TON status HTTP ${res.status}`, {
            code: (body && body.code) ?? null,
            httpStatus: res.status,
            phase: 'status',
        })
    }

    // Onbellek YALNIZ basarili yanitta yazilir: yukaridaki firlatma ya da bir
    // ag hatasi (fetch reddi) onceki degere hic dokunmaz.
    statusCache.set(key, { at: Date.now(), value: body })
    return body
}

// Testler icin: onbellegi sifirlar (argumansiz cagri) ya da verilen
// [anahtar, deger] cifti listesiyle degistirir - TTL sinirlarini gercek
// zaman gecirmeden sinamak icin.
export function _setTonFeeStatusCache(entries) {
    statusCache.clear()
    if (entries) for (const [k, v] of entries) statusCache.set(k, v)
}

/**
 * BOLGE KARARI YALNIZ BURADA VERILIR (design bolum 4). `chainId !== 56` gibi
 * bir kural istemcide tutulsaydi, operator TON'u kapattiginda cuzdan yine
 * gostermeye devam ederdi.
 * @param {{ton?: {enabled?: boolean, rateFresh?: boolean, wallet?: string}}} status
 * @returns {boolean}
 */
export function tonFeeRelayActive(status) {
    const ton = status && status.ton
    // Blok hic yoksa KAPALI kabul edilir - eksik veriyi "acik" saymak, sunucu
    // TON'u kaldirdiginda cuzdanin calismayan bir secenek gostermesi demektir.
    if (!ton) return false
    return !!(ton.enabled && ton.rateFresh && ton.wallet === 'W5')
}

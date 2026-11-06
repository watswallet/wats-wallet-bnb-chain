// Seed import'unda kullanilmis turetilmis hesaplari bulan SAF tarama dongusu.
//
// Ag erisimi burada YOK: "bu adres kullanilmis mi" sorusunu cagiran enjekte eder
// (`probe`; uretimde evmUsageProbe.js `probeEvmAddress`). Boylece durma kurali,
// ust sinir, iptal ve sure asimi sahte bir yoklamayla deterministik test edilir.
//
// NEDEN INDEKS 0 YOKLANMAZ: bugunku davranis ayni (ilk hesap, kullanilmis olsun
// olmasin, her zaman eklenir). Tarama yalniz indeks 1'den baslar ve Hesap 1'in
// uzerine eklenecek hesaplari arar; `included(0)` olayi bu yuzden en basta, hic
// yoklama yapilmadan, `used: true` ile yayilir.
//
// KURALLAR:
//   - Art arda SCAN_STOP_AFTER_UNUSED kullanilmamis indeks gorulunce durulur;
//     kullanilmis bir indeks sayaci sifirlar.
//   - En fazla SCAN_MAX_ACCOUNTS hesap (indeks 0-19).
//   - Eklenecek hesap sayisi = son kullanilmis indeks + 1 (hic yoksa 1): aradaki
//     bos indeksler de dahildir, son kullanilmistan sonrakiler degil.
//   - YARIM TARAMA KORUNUR: ag hatasi ('network_failed') ya da toplam sure asimi
//     ('timed_out') taramayi yarida keser ama o ana kadar bulunanlar atilmaz;
//     sonuc o noktaya kadarki hesap sayisini verir. Hatali indeks sayaca girmez.
//   - 'skipped' (kullanici "Atla" dedi) bulunanlari DA atar: kullanici taramayi
//     istemedi, yalniz Hesap 1 kalir. Atla'dan sonra gelen gec yoklama sonucu yok
//     sayilir (olay yayilmaz, sayac degismez).
//
// SIRA ONEMLI: yoklama donunce ONCE iptal kontrol edilir, SONRA 'failed'. Gercek
// yoklama iptalde 'failed' dondurur; sira ters olsa "Atla" yanlislikla ag hatasi
// ('network_failed') sayilirdi.
import { HDNodeWallet } from 'ethers'
import { HD_BASE_PATH } from './hdAccounts'

// Art arda bu kadar kullanilmamis indeks gorulunce tarama durur.
export const SCAN_STOP_AFTER_UNUSED = 3
// Eklenebilecek en fazla hesap sayisi (indeks 0 .. SCAN_MAX_ACCOUNTS - 1).
export const SCAN_MAX_ACCOUNTS = 20
// Tum tarama icin ust sure; asilirsa o ana kadar bulunanlarla 'timed_out' doner.
export const SCAN_TOTAL_TIMEOUT_MS = 60_000

/** Tarama yarida kesildi mi (ag hatasi ya da sure asimi)? Bulunanlar yine de korunur. */
export function isPartialOutcome(outcome) {
    return outcome === 'network_failed' || outcome === 'timed_out'
}

/**
 * @param {object} args
 * @param {string} args.mnemonic BIP39 ifadesi (kirpilarak kullanilir)
 * @param {(address: string, opts: {signal?: AbortSignal}) => Promise<'used'|'unused'|'failed'>} args.probe
 * @param {AbortSignal} [args.signal] "Atla" iptali
 * @param {(event: object) => void} [args.onProgress]
 *   {type:'checking', index, address} | {type:'checked', index, address, status}
 *   | {type:'included', index, address, used}
 * @param {() => number} [args.now] saat (test icin enjekte edilir)
 * @param {number} [args.maxDurationMs]
 * @returns {Promise<{accountCount: number, usedIndexes: number[],
 *   outcome: 'completed'|'network_failed'|'timed_out'|'skipped'}>}
 */
export async function scanUsedAccounts({
    mnemonic,
    probe,
    signal,
    onProgress,
    now = Date.now,
    maxDurationMs = SCAN_TOTAL_TIMEOUT_MS,
}) {
    // Taban dugum bir kez turetilir (PBKDF2 her indekste tekrarlanmasin); her indeks
    // ondan tek bir cocuk turetmesidir ve `fromPhrase(..., "<taban>/i")` ile ayni adrestir.
    const base = HDNodeWallet.fromPhrase(mnemonic.trim(), '', HD_BASE_PATH)
    const addresses = []
    const addressAt = (index) => {
        if (addresses[index] === undefined) addresses[index] = base.deriveChild(index).address
        return addresses[index]
    }
    const emit = (event) => {
        if (onProgress) onProgress(event)
    }

    const startedAt = now()
    const usedIndexes = []
    let lastUsed = 0
    // Henuz 'included' olarak yayilmamis ilk indeks (0 asagida yayilir).
    let nextToInclude = 1
    let unusedRun = 0

    const finish = (outcome) =>
        outcome === 'skipped'
            ? { accountCount: 1, usedIndexes: [], outcome }
            : { accountCount: lastUsed + 1, usedIndexes, outcome }

    emit({ type: 'included', index: 0, address: addressAt(0), used: true })

    for (let index = 1; index < SCAN_MAX_ACCOUNTS; index++) {
        if (signal?.aborted) return finish('skipped')
        if (now() - startedAt > maxDurationMs) return finish('timed_out')

        const address = addressAt(index)
        emit({ type: 'checking', index, address })
        const status = await probe(address, { signal })

        // Atla'dan sonra donen gec sonuc yok sayilir; 'failed' kontrolunden ONCE.
        if (signal?.aborted) return finish('skipped')
        emit({ type: 'checked', index, address, status })

        if (status === 'failed') return finish('network_failed')

        if (status === 'used') {
            lastUsed = index
            usedIndexes.push(index)
            unusedRun = 0
            // Araya dusen bos indeksler de hesap olur (used=false), kullanilmis olan son.
            for (let i = nextToInclude; i <= index; i++) {
                emit({ type: 'included', index: i, address: addressAt(i), used: i === index })
            }
            nextToInclude = index + 1
        } else {
            unusedRun++
            if (unusedRun >= SCAN_STOP_AFTER_UNUSED) return finish('completed')
        }
    }
    return finish('completed')
}

// Dapp'in verdigi blockhash, onay penceresi ACIKKEN bayatlayabilir (~150 slot,
// ~2 dakika). Bu modul imza ANINDA tazeligi yeniden olcer.
//
// KAPSAM: yalnizca signAndSendTransaction (§6.5). signTransaction'da yayini
// DAPP yapar ve zamanlamayi O yonetir -- orada reddetmek mesru akislari kirar.
//
// Bu dosya @solana/* IMPORT ETMEZ (bufferGlobal shim'i gerekmez): islemin
// icine bakmaz, parseDappTransaction'in coz(um)dugu iki alani okur.
import { solanaRpc } from './client'

// Proxy metodu TANIMIYORSA (beyaz listeye henuz eklenmemis) bunlar doner.
// §11: sunucu deploy'u ile magaza yayini FARKLI kadanslardadir.
//
// 403 ASIL goruleni: solanaController.js:78-81 validateSolanaRpc reddini HER
// ZAMAN 403 ile doner -- bu betikteki gercek "beyaz listede yok" durumu 404/405
// DEGIL, 403'tur. 403 teorik olarak parametre sekli reddini de kapsar, ama
// isBlockhashValid'in TEK parametresi bir dizgedir (solanaPolicy.js:29-33),
// yani gercekci sebep beyaz listedir. 404/405 SETTE kaliyor cunku zarar vermezler
// (ikisi de fail-open'a duser) ve /solana/rpc rotasinin TAMAMEN eksik oldugu bir
// senaryoda (o zaman zaten TUM Solana cagrilari bozuktur) hala olasidirlar.
const PROXY_UNSUPPORTED = new Set(['SOLANA_RPC_HTTP_403', 'SOLANA_RPC_HTTP_404', 'SOLANA_RPC_HTTP_405'])

/**
 * Islemin blockhash alani. legacy'de islemin KENDISINDE, v0'da mesajin icinde.
 * Ayrim `version` ILE yapilir, `instanceof` ile DEGIL (dapp'in web3.js'i ayri
 * bir modul ornegi olabilir -- §3.3'teki AYNI kural).
 */
export function transactionBlockhash(parsed) {
    if (!parsed || !parsed.tx) return null
    if (parsed.version === 'legacy') return parsed.tx.recentBlockhash || null
    return parsed.tx.message?.recentBlockhash || null
}

/**
 * Blockhash hala gecerli mi?
 *
 * DONUS SEKLI BILEREK "atlandi"yi da tasir: cagiran (onay sonrasi imzalama
 * yolu) atlanan bir kontrolu loglayabilsin. `fresh:false` YALNIZCA dugum
 * ACIKCA `value:false` dediginde uretilir -- baska HICBIR yol
 * SOLANA_BLOCKHASH_EXPIRED'a cikmaz:
 *
 *   - durable nonce: blockhash alani bir NONCE'tir, isBlockhashValid onu HER
 *     ZAMAN gecersiz raporlar (§6.5).
 *   - 403 (nadiren 404/405): metot proxy beyaz listesinde yok (§11 FAIL-OPEN).
 *   - zaman asimi / 5xx / okunamayan yanit: "sorgulayamadim", "bayat" DEGIL.
 *     Gercekten bayat bir blockhash'i yayin preflight'i (skipPreflight:false)
 *     zaten reddeder; bir RPC hickirigi yuzunden mesru bir dapp islemini
 *     reddetmek ise kullanicinin kaybi olur.
 */
export async function checkBlockhashFresh(parsed) {
    if (parsed?.isDurableNonce) return { fresh: true, skipped: 'durable_nonce' }

    const blockhash = transactionBlockhash(parsed)
    if (!blockhash) return { fresh: true, skipped: 'no_blockhash' }

    let value
    try {
        const yanit = await solanaRpc('isBlockhashValid', [blockhash, { commitment: 'confirmed' }])
        value = yanit?.value
    } catch (e) {
        const kod = e?.message || e?.name || ''
        const sebep = PROXY_UNSUPPORTED.has(kod) ? 'proxy_unsupported' : 'rpc_unavailable'
        console.warn('[solana-dapp] blockhash tazeligi ATLANDI (fail-open):', kod)
        return { fresh: true, skipped: sebep }
    }

    if (typeof value !== 'boolean') {
        console.warn('[solana-dapp] isBlockhashValid boolean OLMAYAN yanit dondu, kontrol atlanir')
        return { fresh: true, skipped: 'unreadable_response' }
    }

    return value ? { fresh: true, skipped: null } : { fresh: false, code: 'SOLANA_BLOCKHASH_EXPIRED' }
}

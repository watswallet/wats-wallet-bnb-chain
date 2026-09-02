import './bufferGlobal.js'
import { PublicKey } from '@solana/web3.js'

/**
 * Adres katmani — saf. AG YOK.
 *
 * BASE58 BUYUK/KUCUK HARF DUYARLIDIR. Bu dosyada hicbir yerde toLowerCase()
 * cagrilmaz: `Abc...` ile `abc...` FARKLI adreslerdir ve birini otekine
 * indirgemek, kullanicinin parasini yanlis adrese yollamaya acik kapi birakir.
 */

function parse(value) {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    try {
        // PublicKey base58'i cozer VE 32 bayt oldugunu dogrular.
        return new PublicKey(trimmed)
    } catch {
        return null
    }
}

/** base58 olarak cozulebilen, 32 baytlik herhangi bir adres (cuzdan, program, PDA). */
export function isValidSolanaAddress(value) {
    return parse(value) !== null
}

/**
 * Adres bir CUZDAN mi (ed25519 egrisi uzerinde) yoksa turetilmis bir hesap mi
 * (program adresi, PDA, ATA)?
 *
 * Egri disi bir adrese gonderim yapilirsa fonlar GERI ALINAMAZ: o adresin ozel
 * anahtari yoktur, kimse harcayamaz. Kullanicinin bir token hesabi adresini
 * cuzdan adresi sanmasi yaygin bir hatadir; kapi burada.
 */
export function isWalletAddress(value) {
    const key = parse(value)
    return key !== null && PublicKey.isOnCurve(key.toBytes())
}

/** Bosluk atilmis, HARF KASASI KORUNMUS kanonik bicim; gecersizse null. */
export function normalizeSolanaAddress(value) {
    const key = parse(value)
    return key === null ? null : key.toBase58()
}

export function toPublicKey(value) {
    const key = parse(value)
    if (key === null) throw new Error('INVALID_SOLANA_ADDRESS')
    return key
}

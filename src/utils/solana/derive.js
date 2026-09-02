import './bufferGlobal.js'
import { mnemonicToSeed } from 'bip39'
import { computeHmac, getBytes } from 'ethers'
import { Keypair } from '@solana/web3.js'

// SLIP-0010, ed25519 egrisi icin master dugum HMAC anahtari.
const ED25519_CURVE = new TextEncoder().encode('ed25519 seed')
const HARDENED = 0x80000000

// Solana'nin SLIP-44 coin type'i.
const SOLANA_COIN_TYPE = 501

function ser32(index) {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, index, false) // big-endian
    return out
}

function concatBytes(...parts) {
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of parts) { out.set(p, offset); offset += p.length }
    return out
}

/**
 * Turetme yolunu hardened indekslere cevirir.
 *
 * SLIP-0010'da ed25519 icin YALNIZCA hardened turetme tanimlidir: hardened olmayan
 * bir segment sessizce kabul edilirse baska bir cuzdanla uyusmayan, sessizce
 * yanlis bir adres uretilir — kullanici seed'ini Phantom'a tasidiginda parasini
 * bulamaz. Bu yuzden acikca reddedilir.
 */
export function parsePath(path) {
    if (typeof path !== 'string' || (path !== 'm' && !path.startsWith('m/'))) {
        throw new Error('INVALID_PATH')
    }
    if (path === 'm') return []

    return path.slice(2).split('/').map((segment) => {
        if (!segment.endsWith("'")) throw new Error('ED25519_REQUIRES_HARDENED')
        const raw = segment.slice(0, -1)
        const n = Number(raw)
        if (raw === '' || !Number.isInteger(n) || n < 0 || n >= HARDENED) {
            throw new Error('INVALID_PATH')
        }
        return (n + HARDENED) >>> 0
    })
}

/**
 * SLIP-0010 ed25519 turetmesi — tam sonuc (key + chainCode).
 *
 * Iki parcaya ayrilma nedeni: resmi SLIP-0010 test vektorleri hem private
 * key'i hem chain code'u veriyor (bkz. derive.test.js), chain code'u da
 * dogrulayabilmek icin bu ara adimin disaridan gorunur olmasi gerekiyor.
 * slip10DeriveEd25519 asagida bunun ustune ince bir kabuktur.
 */
export function slip10DeriveEd25519Full(seed, path) {
    const master = getBytes(computeHmac('sha512', ED25519_CURVE, seed))
    let key = master.slice(0, 32)
    let chainCode = master.slice(32)

    for (const index of parsePath(path)) {
        const data = concatBytes(new Uint8Array([0]), key, ser32(index))
        const I = getBytes(computeHmac('sha512', chainCode, data))
        key = I.slice(0, 32)
        chainCode = I.slice(32)
    }

    return { key, chainCode }
}

/**
 * SLIP-0010 ed25519 turetmesi. Donen 32 bayt, ed25519 TOHUMUDUR (private key degil);
 * Keypair.fromSeed onu anahtar ciftine cevirir.
 */
export function slip10DeriveEd25519(seed, path) {
    return slip10DeriveEd25519Full(seed, path).key
}

/**
 * Phantom ve Solflare'in kullandigi yol. Kullanici seed'ini oraya tasidiginda
 * AYNI adresi gormeli; bu yuzden yol bir tercih degil, UYUMLULUK SARTIDIR.
 */
export function solanaPath(index) {
    return `m/44'/${SOLANA_COIN_TYPE}'/${index}'/0'`
}

export async function deriveSolanaKeypair(mnemonic, index = 0) {
    const seed = await mnemonicToSeed(mnemonic)
    const key = slip10DeriveEd25519(new Uint8Array(seed), solanaPath(index))
    return Keypair.fromSeed(key)
}

/**
 * Hesap kaydina yazilacak iki alan.
 *
 * `address` base58 ve HARF KASASI ANLAMLIDIR; `publicKey` hex — ayni anahtarin
 * iki gosterimi. publicKey ayri tutulur cunku bazi cagri noktalari ham baytlari
 * ister ve her seferinde base58 cozmek gereksiz.
 */
export async function deriveSolanaAddress(mnemonic, index = 0) {
    const keypair = await deriveSolanaKeypair(mnemonic, index)
    return {
        address: keypair.publicKey.toBase58(),
        publicKey: Buffer.from(keypair.publicKey.toBytes()).toString('hex')
    }
}

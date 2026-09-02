// ton_proof mesajinin BAYT DUZENI -- saf katman.
//
// Neden ayri dosya ve neden bu kadar test: bu duzen dapp'in BACKEND'inde
// dogrulanir. Bir alan yanlis genislikte ya da yanlis siradaysa imza sessizce
// gecersiz olur -- ne cuzdan ne dapp bir hata gosterir, kullanici sadece "giris
// yapamiyorum" der. Yanlisligi ancak byte byte kilitleyen bir test yakalar.
//
// UC LITTLE / BIR BIG: workchain BIG-endian, domain uzunlugu ve timestamp
// LITTLE-endian. Tutarsiz gorunuyor ama protokolun tanimi bu; "duzeltmek"
// imzayi bozar.
//
// AG YOK, chrome YOK, @ton/* YOK.

export const TON_PROOF_PREFIX = 'ton-proof-item-v2/'
const TON_CONNECT_PREFIX = 'ton-connect'

const enc = new TextEncoder()

/**
 * @param {{workchain: number, addressHash: Uint8Array, domain: string, timestamp: number, payload: string}} p
 * @returns {Uint8Array}
 */
export function buildTonProofMessage({ workchain, addressHash, domain, timestamp, payload }) {
    if (!(addressHash instanceof Uint8Array) || addressHash.length !== 32) {
        throw new Error('TON_PROOF_BAD_ADDRESS_HASH')
    }
    if (!Number.isInteger(timestamp) || timestamp < 0) {
        throw new Error('TON_PROOF_BAD_TIMESTAMP')
    }

    const prefixBytes = enc.encode(TON_PROOF_PREFIX)
    const domainBytes = enc.encode(domain ?? '')
    const payloadBytes = enc.encode(payload ?? '')

    const total = prefixBytes.length + 4 + 32 + 4 + domainBytes.length + 8 + payloadBytes.length
    const out = new Uint8Array(total)
    const view = new DataView(out.buffer)
    let offset = 0

    out.set(prefixBytes, offset); offset += prefixBytes.length
    view.setInt32(offset, workchain | 0, false); offset += 4   // BIG-endian
    out.set(addressHash, offset); offset += 32
    view.setUint32(offset, domainBytes.length, true); offset += 4  // LITTLE-endian
    out.set(domainBytes, offset); offset += domainBytes.length
    view.setBigUint64(offset, BigInt(timestamp), true); offset += 8  // LITTLE-endian
    out.set(payloadBytes, offset)

    return out
}

/**
 * Imzalanacak NIHAI girdi. Cagiran once buildTonProofMessage'in ciktisini
 * sha256'lar, sonucu buraya verir; bu fonksiyonun ciktisi TEKRAR sha256'lanip
 * ed25519 ile imzalanir.
 *
 * Hashleme burada DEGIL: WebCrypto async ve bu katman saf/senkron kalmali --
 * boylece bayt duzeni bir Promise'in arkasina saklanmadan test edilebiliyor.
 */
export function tonProofSignInput(messageHash) {
    if (!(messageHash instanceof Uint8Array) || messageHash.length !== 32) {
        throw new Error('TON_PROOF_BAD_MESSAGE_HASH')
    }
    const prefixBytes = enc.encode(TON_CONNECT_PREFIX)
    const out = new Uint8Array(2 + prefixBytes.length + 32)
    out[0] = 0xff
    out[1] = 0xff
    out.set(prefixBytes, 2)
    out.set(messageHash, 2 + prefixBytes.length)
    return out
}

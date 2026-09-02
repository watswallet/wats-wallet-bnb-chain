/**
 * base58 (Bitcoin alfabesi) KODLAMA — saf katman, bagimlilik yok.
 *
 * NEDEN VAR: bir Solana IMZASI 64 bayttir ve kullanicinin/zincirin gordugu bicim
 * base58'dir. Kod tabaninda base58 uretmenin tek yolu `PublicKey#toBase58()` idi
 * ama PublicKey YALNIZCA 32 bayt kabul eder (64 baytlik bir imza icin
 * `new PublicKey(sig)` FIRLATIR), yani imza oradan gecirilemez. @solana/web3.js
 * kendi base58'ini disari acmiyor.
 *
 * Neden bir paket eklenmedi: `bs58` bugun yalnizca AKTARIMLI (transitive) bir
 * bagimlilik; package.json'a eklemek kilit dosyasini bu turda dogrulanamayacak
 * sekilde degistirirdi. Onun yerine standart base-x algoritmasi burada duruyor ve
 * testi BAGIMSIZ bir kaynakla (PublicKey#toBase58, 32 baytlik girdilerde) capraz
 * dogrulaniyor -- yani "dogru mu" sorusunun cevabi bu dosyanin kendi iddiasi degil.
 *
 * Adres/imza KUCULTULMEZ: base58 buyuk/kucuk harf duyarlidir.
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * @param {Uint8Array|Buffer|number[]} bytes
 * @returns {string} base58 dizge
 */
export function base58Encode(bytes) {
    if (bytes == null) throw new Error('BASE58_INVALID_INPUT')
    const input = Uint8Array.from(bytes)
    if (input.length === 0) return ''

    // BAS SIFIRLAR AYRI ele alinir: sayisal donusum onlari yutar ve '1' olarak
    // geri konmazsa iki FARKLI bayt dizisi AYNI dizgeye kodlanir.
    let zeros = 0
    while (zeros < input.length && input[zeros] === 0) zeros += 1

    // log(256)/log(58) ~ 1,365 -> 138/100 guvenli ust sinir.
    const size = Math.floor(((input.length - zeros) * 138) / 100) + 1
    const digits = new Uint8Array(size)

    let length = 0
    for (let i = zeros; i < input.length; i += 1) {
        let carry = input[i]
        let j = 0
        for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
            carry += 256 * digits[k]
            digits[k] = carry % 58
            carry = Math.floor(carry / 58)
        }
        length = j
    }

    let it = size - length
    while (it < size && digits[it] === 0) it += 1

    let out = '1'.repeat(zeros)
    for (; it < size; it += 1) out += ALPHABET[digits[it]]
    return out
}

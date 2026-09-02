// Adres BICIMI tanima ve karsilastirma icin TEK, PAYLASILAN kaynak.
//
// EVM ve Solana (base58) adreslerini ayni ilkeyle ele alir: EVM adresleri
// KUCULTULUR (hex, kasa anlamsiz). Base58 adresler ASLA kucultulmez: buyuk/kucuk
// harf duyarlidir ve kucultulurse iki FARKLI adres ayni anahtara duser — bir
// guvenlik kontrolunde bu "ayni adres, sorun yok" dalini yanlislikla tetikler.
//
// addressPoisoning.js, historyRecipients.js ve (dolayli olarak) knownRecipients.js
// AYNI kurala uysun diye bu dosya tek kopya olarak tutulur. Ucu de kendi
// versiyonunu tutarsa biri digerinden sessizce ayrisabilir — tam olarak bu
// gorevi (Task 13) dogurmus olan hata buydu.
//
// Dosya SAFTIR: chrome API'sine, agsa, depoya dokunmaz.

export const EVM_ADDRESS = /^0x[0-9a-f]{40}$/
export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// Base58 alfabesi yalnizca '0', 'O', 'I', 'l' harflerini disliyor — hex'in
// alfabesi (0-9a-f) bunlarin arasinda yalnizca '0'i kullanir. Sonuc: '0x' ONEKI
// OLMADAN gelen, ic tarafinda hic '0' gecmeyen 40 karakterlik bir hex dize
// (ornegin kullanicinin onekini yanlislikla sildigi bir EVM adresi) base58
// alfabesiyle de KESISIYOR ve Solana sanilabilirdi — kullaniciya bir EVM
// agindayken "bu agda itibar kontrolu yok" gibi YANLIS bir mesaj gosterirdi.
// Gercek bir Solana adresinin TAMAMEN hex alfabesi (0-9a-f) icinde kalan 40
// karakterlik bir dize olmasi istatistiksel olarak ihmal edilebilir ((16/58)^40).
const HEX_BODY_LENGTH = 40
const HEX_ONLY = /^[0-9a-f]+$/i

/**
 * Adresi karsilastirilabilir bir bicime cevirir; gecersizse null.
 *
 * `form` alani, farkli zincirlerin adreslerinin birbiriyle karsilastirilmasini
 * onler: bir EVM adresi ile bir Solana adresi hicbir kosulda "ayni/benzer"
 * degildir. `headOffset`, gosterimde '0x' gibi anlamsiz bir on eki tasiyan
 * bicimler icin kac karakterin "on ek" sayildigini belirtir (EVM'de 2, Solana'da 0).
 */
export function canonicalAddress(address) {
    if (!address || typeof address !== 'string') return null
    const trimmed = address.trim()

    const lower = trimmed.toLowerCase()
    if (EVM_ADDRESS.test(lower)) {
        return { form: 'evm', key: lower, headOffset: 2 }
    }

    // '0x' onekiyle eslesmedi. Onek DUSMUS bir EVM adresi olabilecek 40
    // karakterlik SAF hex dizeyi Solana sanmamak icin burada durulur — ne EVM
    // (onek yok) ne Solana (muhtemelen onek dusmus bir EVM adresi) sayilir.
    if (trimmed.length === HEX_BODY_LENGTH && HEX_ONLY.test(trimmed)) return null

    if (BASE58_ADDRESS.test(trimmed)) {
        return { form: 'solana', key: trimmed, headOffset: 0 }
    }

    return null
}

// Tekillestirme/karsilastirma anahtari: form+key birlikte. Ayni karakter dizisi
// iki bicimde zaten gecerli olamaz (EVM'nin zorunlu '0x' on eki base58 alfabesinde
// yok) ama bicim ayrimi yine de acikca korunur.
export function dedupeKey(address) {
    const c = canonicalAddress(address)
    return c ? `${c.form}:${c.key}` : null
}

// Iki adres GERCEKTEN ayni mi (bicim + anahtar esitligi)? Gecersiz veya farkli
// bicimdeki adresler icin HER ZAMAN false — cagiran taraf ekstra kontrol eklemek
// zorunda kalmasin diye.
export function isSameAddress(a, b) {
    const ca = canonicalAddress(a)
    const cb = canonicalAddress(b)
    return !!ca && !!cb && ca.form === cb.form && ca.key === cb.key
}

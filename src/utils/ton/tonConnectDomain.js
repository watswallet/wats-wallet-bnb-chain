// TonConnect imzalarinda (ton_proof, signData) alan adi kurali -- saf katman.
//
// connect.md Domain-binding rules: ad en az bir '.' icermeli ve noktanin iki
// yaninda gecerli karakter olmali. Noktasiz adlar (tonkeeper, tonhub,
// localhost) yerel cuzdan entegrasyonlarina ayrilmis; dis dapp'ten KABUL
// EDILMEZ.
//
// AG YOK, chrome YOK, import YOK.

const ETIKET = /^[a-z0-9_-]+$/i

/**
 * Imzalanacak hostname noktali ve gecerli mi? Girdi URL'den cozulmus bir
 * hostname'dir (IDN zaten punycode). Sondaki TEK nokta FQDN kokudur, atilir.
 */
export function isDottedDomain(host) {
    if (typeof host !== 'string') return false
    const ad = host.endsWith('.') ? host.slice(0, -1) : host
    const etiketler = ad.split('.')
    return etiketler.length >= 2 && etiketler.every((e) => ETIKET.test(e))
}

/**
 * Ham birim dizesi -> ondalik metin (SAF; ag yok, chrome yok).
 *
 * Tutar hesabi BigInt'tir (Constraint 17): `Number` 2^53 ustunde hassasiyet
 * kaybeder ve ekranda kullanicinin hic onaylamadigi bir tutar olusurdu.
 * `ethers.formatUnits` kullanilmaz: saglayici/talimat kaynakli `decimals` 0..255
 * olabilir ve ethers 255'te FIRLATIR.
 *
 * Girdi tam sayi dizesi (ya da BigInt) ve 0..255 tam sayi `decimals` degilse
 * `null` doner: cagiran "cozulemedi" gosterir, bir rakam UYDURMAZ.
 *
 * @param {string|bigint|null|undefined} ham  negatif olmayan tam sayi (en kucuk birim)
 * @param {number|null|undefined} decimals
 * @returns {string|null} orn. '1.5'; tam sayida ondalik yok; sondaki sifirlar kirpilir
 */
export function formatRawAmount(ham, decimals) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null
    let deger
    if (typeof ham === 'bigint') {
        deger = ham
    } else if (typeof ham === 'string' && /^[0-9]+$/.test(ham)) {
        deger = BigInt(ham)
    } else {
        return null
    }
    if (deger < 0n) return null

    const metin = deger.toString().padStart(decimals + 1, '0')
    const tam = metin.slice(0, metin.length - decimals)
    const kesir = metin.slice(metin.length - decimals).replace(/0+$/, '')
    return kesir === '' ? tam : `${tam}.${kesir}`
}
